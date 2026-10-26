import { savedCardListSchema, savedCardSchema } from '@bravo/core';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createUser, loginAs } from '../../../test/factories';
import { forbiddenFetch, send, testEnv } from '../../../test/http';
import { requireTestDatabaseUrl } from '../../../test/require-test-db';
import { createApp } from '../../app';
import { createDb, withTransaction } from '../../db/client';
import { charges, consents, paymentCustomers, savedCards, users } from '../../db/schema';
import { runSeed } from '../../db/seed';
import { createCharge } from '../../modules/payments/charges.service';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

const NOW = new Date('2026-10-20T12:00:00.000Z');
beforeEach(async () => {
  await runSeed(db);
});

const buildApp = () => createApp({ db, now: () => NOW, fetch: forbiddenFetch, env: testEnv() });

async function tenant(email = 'ana@bravoclinic.test', doc = '52998224725') {
  const user = await createUser(db, { email, name: 'Ana Souza' });
  await db.update(users).set({ docType: 'cpf', docNumber: doc }).where(eq(users.id, user.id));
  return { user, cookie: await loginAs(db, user, { now: NOW }) };
}

const addCard = (cookie: string, body: Record<string, unknown>) =>
  send(buildApp(), 'POST', '/app/cards', { cookie, body });

describe('POST /app/cards (NUC-126)', () => {
  it('saves the card with its last4, brand and expiry, the customer and a recurring_charge consent', async () => {
    const { user, cookie } = await tenant();

    const res = await addCard(cookie, { cardToken: 'tok_sandbox_4242', recurringConsent: true });

    expect(res.status).toBe(201);
    const card = savedCardSchema.parse(res.body);
    expect(card).toMatchObject({
      brand: 'visa',
      last4: '4242',
      expMonth: 12,
      expYear: 2030,
      recurringConsentAt: NOW.toISOString(),
    });
    const [row] = await db.select().from(savedCards);
    expect(row).toMatchObject({
      id: card.id,
      userId: user.id,
      provider: 'sandbox',
      last4: '4242',
      deletedAt: null,
      recurringConsentAt: NOW,
    });
    expect(row?.externalCardId.startsWith('sbx_card_4242_')).toBe(true);
    const [customer] = await db.select().from(paymentCustomers);
    expect(customer).toMatchObject({
      userId: user.id,
      provider: 'sandbox',
      externalCustomerId: `sbx_cus_${user.id}`,
    });
    const [consent] = await db.select().from(consents);
    expect(consent).toMatchObject({
      userId: user.id,
      kind: 'recurring_charge',
      refType: 'saved_card',
      refId: card.id,
    });
  });

  it('answers 422 without the recurring consent and saves nothing', async () => {
    const { cookie } = await tenant();

    const missing = await addCard(cookie, { cardToken: 'tok_sandbox_4242' });
    const declined = await addCard(cookie, {
      cardToken: 'tok_sandbox_4242',
      recurringConsent: false,
    });

    expect([missing.status, declined.status]).toEqual([422, 422]);
    expect(missing.error?.code).toBe('VALIDATION_FAILED');
    expect(await db.select().from(savedCards)).toHaveLength(0);
    expect(await db.select().from(consents)).toHaveLength(0);
  });

  it('answers 422 for a body that carries a card number, CVV or a PAN-like token (NUC-128)', async () => {
    const { cookie } = await tenant();

    const withNumber = await addCard(cookie, {
      cardToken: 'tok_sandbox_4242',
      recurringConsent: true,
      cardNumber: '4111111111111111',
    });
    const withCvv = await addCard(cookie, {
      cardToken: 'tok_sandbox_4242',
      recurringConsent: true,
      cvv: '123',
    });
    const panAsToken = await addCard(cookie, {
      cardToken: '4111 1111 1111 1111',
      recurringConsent: true,
    });

    expect([withNumber.status, withCvv.status, panAsToken.status]).toEqual([422, 422, 422]);
    expect(withNumber.error?.details).toEqual([
      { path: 'cardNumber', message: expect.stringContaining('cartão') as string },
    ]);
    expect(panAsToken.error?.details).toEqual([
      { path: 'cardToken', message: expect.stringContaining('cartão') as string },
    ]);
    expect(await db.select().from(savedCards)).toHaveLength(0);
  });

  it('requires a signed-in tenant and a CPF or CNPJ', async () => {
    const anonymous = await send(buildApp(), 'POST', '/app/cards', {
      body: { cardToken: 'tok_sandbox_4242', recurringConsent: true },
    });
    const user = await createUser(db, { email: 'semdoc@bravoclinic.test' });
    const noDoc = await addCard(await loginAs(db, user, { now: NOW }), {
      cardToken: 'tok_sandbox_4242',
      recurringConsent: true,
    });

    expect(anonymous.status).toBe(401);
    expect(noDoc.status).toBe(422);
    expect(noDoc.error?.code).toBe('PROFILE_INCOMPLETE');
  });

  it('reuses the gateway customer for a second card', async () => {
    const { cookie } = await tenant();

    await addCard(cookie, { cardToken: 'tok_sandbox_4242', recurringConsent: true });
    await addCard(cookie, { cardToken: 'tok_sandbox_1111', recurringConsent: true });

    expect(await db.select().from(paymentCustomers)).toHaveLength(1);
    expect(await db.select().from(savedCards)).toHaveLength(2);
  });
});

describe('GET and DELETE /app/cards (NUC-127)', () => {
  it('lists only the caller’s live cards, newest first', async () => {
    const { cookie } = await tenant();
    const other = await tenant('bia@bravoclinic.test', '11144477735');
    await addCard(cookie, { cardToken: 'tok_sandbox_4242', recurringConsent: true });
    await addCard(cookie, { cardToken: 'tok_sandbox_1111', recurringConsent: true });
    await addCard(other.cookie, { cardToken: 'tok_sandbox_9999', recurringConsent: true });

    const res = await send(buildApp(), 'GET', '/app/cards', { cookie });

    const list = savedCardListSchema.parse(res.body);
    expect(list.items.map((c) => c.last4)).toEqual(['1111', '4242']);
  });

  it('delete sets deleted_at, answers 204 and drops the card from the list', async () => {
    const { cookie } = await tenant();
    const created = savedCardSchema.parse(
      (await addCard(cookie, { cardToken: 'tok_sandbox_4242', recurringConsent: true })).body,
    );

    const res = await send(buildApp(), 'DELETE', `/app/cards/${created.id}`, { cookie });

    expect(res.status).toBe(204);
    const [row] = await db.select().from(savedCards).where(eq(savedCards.id, created.id));
    expect(row?.deletedAt).toEqual(NOW);
    const list = await send(buildApp(), 'GET', '/app/cards', { cookie });
    expect(savedCardListSchema.parse(list.body).items).toEqual([]);
    const again = await send(buildApp(), 'DELETE', `/app/cards/${created.id}`, { cookie });
    expect(again.status).toBe(404);
  });

  it('answers 404 when deleting another user’s card, which stays live', async () => {
    const { cookie } = await tenant();
    const other = await tenant('bia@bravoclinic.test', '11144477735');
    const created = savedCardSchema.parse(
      (await addCard(other.cookie, { cardToken: 'tok_sandbox_4242', recurringConsent: true })).body,
    );

    const res = await send(buildApp(), 'DELETE', `/app/cards/${created.id}`, { cookie });

    expect(res.status).toBe(404);
    const [row] = await db.select().from(savedCards).where(eq(savedCards.id, created.id));
    expect(row?.deletedAt).toBeNull();
  });

  it('a deleted card cannot be used to pay', async () => {
    const { user, cookie } = await tenant();
    const created = savedCardSchema.parse(
      (await addCard(cookie, { cardToken: 'tok_sandbox_4242', recurringConsent: true })).body,
    );
    await send(buildApp(), 'DELETE', `/app/cards/${created.id}`, { cookie });
    const ctx = {
      actorUserId: user.id,
      actorRole: 'tenant',
      origin: 'app' as const,
      ip: null,
      requestId: null,
    };

    await expect(
      withTransaction(db, (tx) =>
        createCharge(tx, ctx, {
          purpose: 'extra_hours',
          userId: user.id,
          amountCents: 1000,
          method: 'saved_card',
          savedCardId: created.id,
          expiresAt: NOW,
        }),
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(await db.select().from(charges)).toHaveLength(0);
  });
});
