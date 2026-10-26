import { randomUUID } from 'node:crypto';
import { chargeIntentSchema } from '@bravo/core';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createBooking, createUser, loginAs } from '../../../test/factories';
import { forbiddenFetch, send, testEnv } from '../../../test/http';
import { requireTestDatabaseUrl } from '../../../test/require-test-db';
import { createApp } from '../../app';
import { createDb, withTransaction } from '../../db/client';
import {
  bookings,
  charges,
  consents,
  idempotencyKeys,
  integrationSettings,
  rooms,
  savedCards,
  users,
} from '../../db/schema';
import { runSeed } from '../../db/seed';
import { getEnv } from '../../env';
import { encryptSecret } from '../../lib/crypto';
import { createCharge, submitCharge } from '../../modules/payments/charges.service';
import { saveSetting } from '../../modules/settings/settings.repo';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

const NOW = new Date('2026-10-20T12:00:00.000Z');
const HOLD = new Date('2026-10-20T12:15:00.000Z');
const STARTS = new Date('2026-10-27T13:00:00.000Z');
const ENDS = new Date('2026-10-27T15:00:00.000Z');

let roomId = '';

beforeEach(async () => {
  await runSeed(db);
  const [room] = await db.select().from(rooms).limit(1);
  roomId = room?.id ?? '';
});

const buildApp = (fetchImpl: typeof fetch = forbiddenFetch) =>
  createApp({ db, now: () => NOW, fetch: fetchImpl, env: testEnv() });

/** A tenant with CPF and a session cookie. */
async function tenant(email = 'ana@bravoclinic.test') {
  const user = await createUser(db, { email, name: 'Ana Souza' });
  const doc = email.startsWith('ana') ? '52998224725' : '11144477735';
  await db.update(users).set({ docType: 'cpf', docNumber: doc }).where(eq(users.id, user.id));
  return { user, cookie: await loginAs(db, user, { now: NOW }) };
}

/** An `awaiting_payment` booking of 219,00 with the 50% sinal unpaid, holding until HOLD. */
async function awaitingBooking(
  userId: string,
  overrides: Partial<Parameters<typeof createBooking>[1]> = {},
) {
  return createBooking(db, {
    userId,
    roomId,
    startsAt: STARTS,
    endsAt: ENDS,
    status: 'awaiting_payment',
    totalCents: 21900,
    depositCents: 10950,
    paidCents: 0,
    holdExpiresAt: HOLD,
    balanceDueAt: new Date('2026-10-26T13:00:00.000Z'),
    ...overrides,
  });
}

const pay = (
  cookie: string,
  bookingId: string,
  body: Record<string, unknown>,
  key: string | null = randomUUID(),
  app = buildApp(),
) =>
  send(app, 'POST', `/app/bookings/${bookingId}/pay`, {
    cookie,
    body,
    ...(key !== null && { headers: { 'Idempotency-Key': key } }),
  });

const payBalance = (cookie: string, bookingId: string, body: Record<string, unknown>) =>
  send(buildApp(), 'POST', `/app/bookings/${bookingId}/pay-balance`, {
    cookie,
    body,
    headers: { 'Idempotency-Key': randomUUID() },
  });

const allCharges = () => db.select().from(charges);
const POLICY_ACCEPTED = { acceptPolicy: true, policyVersion: 1 };

async function recordPolicyConsent(userId: string, bookingId: string) {
  await db.insert(consents).values({
    userId,
    kind: 'booking_policy',
    version: 'policy-v1',
    refType: 'booking',
    refId: bookingId,
  });
}

describe('Idempotency-Key on pay (NUC-95)', () => {
  it('answers 400 BAD_REQUEST without the key and creates nothing', async () => {
    const { user, cookie } = await tenant();
    const booking = await awaitingBooking(user.id);
    await recordPolicyConsent(user.id, booking.id);

    const res = await pay(cookie, booking.id, { method: 'pix' }, null);

    expect(res.status).toBe(400);
    expect(res.error?.code).toBe('BAD_REQUEST');
    expect(await allCharges()).toHaveLength(0);
  });

  it('replays the stored status and body for the same key and body, creating one charge', async () => {
    const { user, cookie } = await tenant();
    const booking = await awaitingBooking(user.id);
    await recordPolicyConsent(user.id, booking.id);
    const key = randomUUID();
    const app = buildApp();

    const first = await pay(cookie, booking.id, { method: 'pix' }, key, app);
    const second = await pay(cookie, booking.id, { method: 'pix' }, key, app);

    expect(first.status).toBe(200);
    expect(second.status).toBe(first.status);
    expect(second.body).toEqual(first.body);
    expect(second.headers.get('Idempotent-Replayed')).toBe('true');
    expect(await allCharges()).toHaveLength(1);
  });

  it('answers 422 IDEMPOTENCY_MISMATCH for the same key with another body', async () => {
    const { user, cookie } = await tenant();
    const booking = await awaitingBooking(user.id);
    await recordPolicyConsent(user.id, booking.id);
    const key = randomUUID();

    await pay(cookie, booking.id, { method: 'pix' }, key);
    const other = await pay(cookie, booking.id, { method: 'card' }, key);

    expect(other.status).toBe(422);
    expect(other.error?.code).toBe('IDEMPOTENCY_MISMATCH');
    expect(await allCharges()).toHaveLength(1);
  });

  it('treats a reordered JSON body as the same request', async () => {
    const { user, cookie } = await tenant();
    const booking = await awaitingBooking(user.id);
    const key = randomUUID();

    const first = await pay(cookie, booking.id, { method: 'pix', ...POLICY_ACCEPTED }, key);
    const second = await pay(
      cookie,
      booking.id,
      { policyVersion: 1, acceptPolicy: true, method: 'pix' },
      key,
    );

    expect(first.status).toBe(200);
    expect(second.headers.get('Idempotent-Replayed')).toBe('true');
  });

  it('lets an expired key be used again', async () => {
    const { user, cookie } = await tenant();
    const booking = await awaitingBooking(user.id);
    await recordPolicyConsent(user.id, booking.id);
    const key = randomUUID();
    await pay(cookie, booking.id, { method: 'pix' }, key);
    await db.update(idempotencyKeys).set({ expiresAt: new Date('2026-10-20T11:00:00.000Z') });

    const again = await pay(cookie, booking.id, { method: 'pix' }, key);

    expect(again.status).toBe(200);
    expect(again.headers.get('Idempotent-Replayed')).toBeNull();
  });
});

describe('POST /app/bookings/:id/pay (NUC-107..NUC-110)', () => {
  it('creates a booking_deposit Pix charge for payNow expiring at the hold, parsed by chargeIntentSchema', async () => {
    const { user, cookie } = await tenant();
    const booking = await awaitingBooking(user.id);
    await recordPolicyConsent(user.id, booking.id);

    const res = await pay(cookie, booking.id, { method: 'pix' });

    expect(res.status).toBe(200);
    const intent = chargeIntentSchema.parse(res.body);
    const [row] = await allCharges();
    expect(row).toMatchObject({
      purpose: 'booking_deposit',
      method: 'pix',
      provider: 'sandbox',
      bookingId: booking.id,
      userId: user.id,
      amountCents: 10950,
      status: 'pending',
      expiresAt: HOLD,
    });
    expect(row?.externalId).toBe(`sbx_${row?.id}`);
    expect(intent).toMatchObject({
      chargeId: row?.id,
      method: 'pix',
      status: 'pending',
      amountCents: 10950,
      expiresAt: HOLD.toISOString(),
      pixCopyPaste: `00020126SANDBOX${row?.id}`,
    });
    expect(intent.checkoutUrl).toBe(`http://localhost:5173/pagamento/sandbox/${row?.id}`);
  });

  it('creates a booking_full charge for the whole amount when the booking starts under 48 h', async () => {
    const { user, cookie } = await tenant();
    const booking = await awaitingBooking(user.id, {
      paymentMode: 'full_upfront',
      depositCents: 21900,
      balanceDueAt: null,
    });
    await recordPolicyConsent(user.id, booking.id);

    const res = await pay(cookie, booking.id, { method: 'card' });

    expect(res.status).toBe(200);
    const [row] = await allCharges();
    expect(row).toMatchObject({ purpose: 'booking_full', method: 'card', amountCents: 21900 });
    expect(chargeIntentSchema.parse(res.body).checkoutUrl).toContain('/pagamento/sandbox/');
  });

  it('pays only what is still due after credits counted as paid', async () => {
    const { user, cookie } = await tenant();
    const booking = await awaitingBooking(user.id, { paidCents: 2000 });
    await recordPolicyConsent(user.id, booking.id);

    await pay(cookie, booking.id, { method: 'pix' });

    expect((await allCharges())[0]?.amountCents).toBe(8950);
  });

  it('answers 404 for a booking of another user', async () => {
    const { user } = await tenant();
    const other = await tenant('bia@bravoclinic.test');
    const booking = await awaitingBooking(user.id);

    const res = await pay(other.cookie, booking.id, { method: 'pix', ...POLICY_ACCEPTED });

    expect(res.status).toBe(404);
    expect(res.error?.code).toBe('NOT_FOUND');
    expect(await allCharges()).toHaveLength(0);
  });

  it('answers 409 HOLD_EXPIRED when the hold is over, even before the job expired the booking', async () => {
    const { user, cookie } = await tenant();
    const stale = await awaitingBooking(user.id, {
      holdExpiresAt: new Date('2026-10-20T11:59:00.000Z'),
    });
    const expired = await awaitingBooking(user.id, {
      status: 'expired',
      startsAt: new Date('2026-10-28T13:00:00.000Z'),
      endsAt: new Date('2026-10-28T15:00:00.000Z'),
    });

    for (const booking of [stale, expired]) {
      const res = await pay(cookie, booking.id, { method: 'pix', ...POLICY_ACCEPTED });
      expect(res.status).toBe(409);
      expect(res.error?.code).toBe('HOLD_EXPIRED');
    }
    expect(await allCharges()).toHaveLength(0);
  });

  it('answers 409 INVALID_TRANSITION for a booking that no longer awaits payment', async () => {
    const { user, cookie } = await tenant();
    const booking = await awaitingBooking(user.id, { status: 'confirmed', holdExpiresAt: null });

    const res = await pay(cookie, booking.id, { method: 'pix', ...POLICY_ACCEPTED });

    expect(res.status).toBe(409);
    expect(res.error?.code).toBe('INVALID_TRANSITION');
  });

  it('reuses the pending charge for the same method and replaces it for another method', async () => {
    const { user, cookie } = await tenant();
    const booking = await awaitingBooking(user.id);
    await recordPolicyConsent(user.id, booking.id);

    const first = await pay(cookie, booking.id, { method: 'pix' });
    const again = await pay(cookie, booking.id, { method: 'pix' });
    const card = await pay(cookie, booking.id, { method: 'card' });

    const firstId = chargeIntentSchema.parse(first.body).chargeId;
    expect(chargeIntentSchema.parse(again.body).chargeId).toBe(firstId);
    const rows = await allCharges();
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === firstId)?.status).toBe('cancelled');
    expect(rows.find((r) => r.method === 'card')?.status).toBe('pending');
    expect(chargeIntentSchema.parse(card.body).chargeId).not.toBe(firstId);
  });

  it('answers 422 PROFILE_INCOMPLETE and writes no charge when the payer has no document', async () => {
    const user = await createUser(db, { email: 'semdoc@bravoclinic.test' });
    const cookie = await loginAs(db, user, { now: NOW });
    const booking = await awaitingBooking(user.id);
    await recordPolicyConsent(user.id, booking.id);

    const res = await pay(cookie, booking.id, { method: 'pix' });

    expect(res.status).toBe(422);
    expect(res.error?.code).toBe('PROFILE_INCOMPLETE');
    expect(await allCharges()).toHaveLength(0);
  });

  it('validates the body: a saved card is required for method saved_card', async () => {
    const { user, cookie } = await tenant();
    const booking = await awaitingBooking(user.id);

    const res = await pay(cookie, booking.id, { method: 'saved_card' });

    expect(res.status).toBe(422);
    expect(res.error?.code).toBe('VALIDATION_FAILED');
  });

  it("answers 404 for another user's saved card", async () => {
    const { user, cookie } = await tenant();
    const other = await tenant('bia@bravoclinic.test');
    const booking = await awaitingBooking(user.id);
    await recordPolicyConsent(user.id, booking.id);
    const [card] = await db
      .insert(savedCards)
      .values({
        userId: other.user.id,
        provider: 'sandbox',
        externalCardId: 'sbx_card_4242_x',
        brand: 'visa',
        last4: '4242',
        expMonth: 12,
        expYear: 2030,
      })
      .returning();

    const res = await pay(cookie, booking.id, { method: 'saved_card', savedCardId: card?.id });

    expect(res.status).toBe(404);
    expect(await allCharges()).toHaveLength(0);
  });
});

describe('policy acceptance on pay (NUC-110)', () => {
  it('answers 422 POLICY_ACCEPTANCE_REQUIRED when a staff booking has no consent yet', async () => {
    const { user, cookie } = await tenant();
    const booking = await awaitingBooking(user.id, { status: 'pre_reserved', source: 'admin' });

    const missing = await pay(cookie, booking.id, { method: 'pix' });
    const declined = await pay(cookie, booking.id, { method: 'pix', acceptPolicy: false });

    expect(missing.status).toBe(422);
    expect(missing.error?.code).toBe('POLICY_ACCEPTANCE_REQUIRED');
    expect(declined.error?.code).toBe('POLICY_ACCEPTANCE_REQUIRED');
    expect(await allCharges()).toHaveLength(0);
  });

  it('records a booking_policy consent with the snapshot version when accepted', async () => {
    const { user, cookie } = await tenant();
    const booking = await awaitingBooking(user.id, { status: 'pre_reserved', source: 'admin' });

    const res = await pay(cookie, booking.id, { method: 'pix', ...POLICY_ACCEPTED });

    expect(res.status).toBe(200);
    const rows = await db.select().from(consents);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: user.id,
      kind: 'booking_policy',
      version: 'policy-v1',
      refType: 'booking',
      refId: booking.id,
    });
  });

  it('answers 409 POLICY_CHANGED when the accepted version is not the booking snapshot', async () => {
    const { user, cookie } = await tenant();
    const booking = await awaitingBooking(user.id, { status: 'pre_reserved', source: 'admin' });

    const res = await pay(cookie, booking.id, {
      method: 'pix',
      acceptPolicy: true,
      policyVersion: 2,
    });

    expect(res.status).toBe(409);
    expect(res.error?.code).toBe('POLICY_CHANGED');
    expect(await db.select().from(consents)).toHaveLength(0);
  });

  it('asks nothing when the booking already has its consent', async () => {
    const { user, cookie } = await tenant();
    const booking = await awaitingBooking(user.id);
    await recordPolicyConsent(user.id, booking.id);

    const res = await pay(cookie, booking.id, { method: 'pix' });

    expect(res.status).toBe(200);
    expect(await db.select().from(consents)).toHaveLength(1);
  });
});

describe('gateway failures (NUC-111, NUC-125)', () => {
  async function useMercadoPago() {
    await withTransaction(db, (tx) =>
      saveSetting(tx, 'payment.active_gateway', 'mercadopago', null),
    );
  }

  it('answers 503 GATEWAY_NOT_CONFIGURED and writes no charge without credentials', async () => {
    const { user, cookie } = await tenant();
    const booking = await awaitingBooking(user.id);
    await recordPolicyConsent(user.id, booking.id);
    await useMercadoPago();

    const res = await pay(cookie, booking.id, { method: 'pix' });

    expect(res.status).toBe(503);
    expect(res.error?.code).toBe('GATEWAY_NOT_CONFIGURED');
    expect(await allCharges()).toHaveLength(0);
  });

  it('answers 502 GATEWAY_ERROR, keeps the charge pending and replays the 502 for the same key', async () => {
    const { user, cookie } = await tenant();
    const booking = await awaitingBooking(user.id);
    await recordPolicyConsent(user.id, booking.id);
    await useMercadoPago();
    await db.insert(integrationSettings).values({
      key: 'gateway.mercadopago',
      environment: 'test',
      secretCiphertext: encryptSecret(
        JSON.stringify({ accessToken: 'APP_USR-x' }),
        getEnv().ENCRYPTION_KEY,
      ),
    });
    const failing: typeof fetch = () => Promise.reject(new TypeError('connect ETIMEDOUT'));
    const app = buildApp(failing);
    const key = randomUUID();

    const first = await pay(cookie, booking.id, { method: 'pix' }, key, app);
    const replay = await pay(cookie, booking.id, { method: 'pix' }, key, app);

    expect(first.status).toBe(502);
    expect(first.error?.code).toBe('GATEWAY_ERROR');
    expect(first.error?.message).toBe('Não foi possível iniciar o pagamento. Tente novamente.');
    expect(replay.status).toBe(502);
    expect(replay.headers.get('Idempotent-Replayed')).toBe('true');
    const rows = await allCharges();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'pending', externalId: null, provider: 'mercadopago' });
  });
});

describe('POST /app/bookings/:id/pay-balance (NUC-134, NUC-135)', () => {
  const confirmed = (userId: string, overrides = {}) =>
    awaitingBooking(userId, {
      status: 'confirmed',
      paidCents: 10950,
      holdExpiresAt: null,
      ...overrides,
    });

  it('creates a booking_balance charge for the balance expiring at balance_due_at', async () => {
    const { user, cookie } = await tenant();
    const booking = await confirmed(user.id);

    const res = await payBalance(cookie, booking.id, { method: 'pix' });

    expect(res.status).toBe(200);
    chargeIntentSchema.parse(res.body);
    const [row] = await allCharges();
    expect(row).toMatchObject({
      purpose: 'booking_balance',
      amountCents: 10950,
      status: 'pending',
      expiresAt: new Date('2026-10-26T13:00:00.000Z'),
    });
  });

  it('creates a booking_difference charge once a balance charge was approved', async () => {
    const { user, cookie } = await tenant();
    const booking = await confirmed(user.id);
    await db.insert(charges).values({
      provider: 'sandbox',
      purpose: 'booking_balance',
      method: 'pix',
      userId: user.id,
      bookingId: booking.id,
      amountCents: 10950,
      status: 'approved',
      idempotencyKey: 'old-balance',
    });
    // An admin reschedule added 20,00 to the balance afterwards.
    await db.update(bookings).set({ balanceCents: 2000 }).where(eq(bookings.id, booking.id));

    const res = await payBalance(cookie, booking.id, { method: 'pix' });

    expect(res.status).toBe(200);
    const created = (await allCharges()).find((c) => c.idempotencyKey !== 'old-balance');
    expect(created).toMatchObject({ purpose: 'booking_difference', amountCents: 2000 });
  });

  it('answers 409 INVALID_TRANSITION when there is no balance, the booking is not confirmed or the deadline passed', async () => {
    const { user, cookie } = await tenant();
    const noBalance = await confirmed(user.id, { paidCents: 21900 });
    const awaiting = await awaitingBooking(user.id, {
      startsAt: new Date('2026-10-28T13:00:00.000Z'),
      endsAt: new Date('2026-10-28T15:00:00.000Z'),
    });
    const late = await confirmed(user.id, {
      startsAt: new Date('2026-10-29T13:00:00.000Z'),
      endsAt: new Date('2026-10-29T15:00:00.000Z'),
      balanceDueAt: new Date('2026-10-20T11:00:00.000Z'),
    });

    for (const booking of [noBalance, awaiting, late]) {
      const res = await payBalance(cookie, booking.id, { method: 'pix' });
      expect(res.status).toBe(409);
      expect(res.error?.code).toBe('INVALID_TRANSITION');
    }
    expect(await allCharges()).toHaveLength(0);
  });

  it('answers 404 for another tenant and 400 without the Idempotency-Key', async () => {
    const { user, cookie } = await tenant();
    const other = await tenant('bia@bravoclinic.test');
    const booking = await confirmed(user.id);

    const stranger = await payBalance(other.cookie, booking.id, { method: 'pix' });
    const keyless = await send(buildApp(), 'POST', `/app/bookings/${booking.id}/pay-balance`, {
      cookie,
      body: { method: 'pix' },
    });

    expect(stranger.status).toBe(404);
    expect(keyless.status).toBe(400);
  });
});

describe('generic charges without a booking (NUC-209)', () => {
  it('createCharge writes a pending extra_hours charge and submitCharge calls the gateway', async () => {
    const { user } = await tenant();
    const ctx = {
      actorUserId: user.id,
      actorRole: 'tenant',
      origin: 'app' as const,
      ip: null,
      requestId: null,
    };

    const charge = await withTransaction(db, (tx) =>
      createCharge(tx, ctx, {
        purpose: 'extra_hours',
        userId: user.id,
        amountCents: 30000,
        method: 'pix',
        expiresAt: new Date('2026-10-20T13:00:00.000Z'),
      }),
    );

    expect(charge).toMatchObject({
      purpose: 'extra_hours',
      bookingId: null,
      status: 'pending',
      amountCents: 30000,
      provider: 'sandbox',
      externalId: null,
    });

    const submitted = await submitCharge(
      { db, env: testEnv(), fetch: forbiddenFetch, now: () => NOW },
      charge.id,
    );

    expect(submitted.externalId).toBe(`sbx_${charge.id}`);
    expect(submitted.pixCopyPaste).toBe(`00020126SANDBOX${charge.id}`);
    expect(submitted.status).toBe('pending');
  });

  it('submitCharge is a no-op for a charge that was already submitted', async () => {
    const { user } = await tenant();
    const ctx = {
      actorUserId: user.id,
      actorRole: 'tenant',
      origin: 'app' as const,
      ip: null,
      requestId: null,
    };
    const charge = await withTransaction(db, (tx) =>
      createCharge(tx, ctx, {
        purpose: 'extra_service',
        userId: user.id,
        amountCents: 5000,
        method: 'pix',
        expiresAt: new Date('2026-10-20T13:00:00.000Z'),
      }),
    );
    const deps = { db, env: testEnv(), fetch: forbiddenFetch, now: () => NOW };

    const first = await submitCharge(deps, charge.id);
    const second = await submitCharge(deps, charge.id);

    expect(second.updatedAt).toEqual(first.updatedAt);
    expect(second.pixCopyPaste).toBe(first.pixCopyPaste);
  });
});
