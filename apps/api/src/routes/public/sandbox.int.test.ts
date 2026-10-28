import { randomUUID } from 'node:crypto';
import { sandboxActionSchema, sandboxChargeSchema } from '@bravo/core';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createBooking, createUser, loginAs } from '../../../test/factories';
import { forbiddenFetch, send, testEnv } from '../../../test/http';
import { requireTestDatabaseUrl } from '../../../test/require-test-db';
import { createApp } from '../../app';
import { createDb, withTransaction } from '../../db/client';
import {
  auditLog,
  bookings,
  charges,
  integrationSettings,
  rooms,
  webhookEvents,
} from '../../db/schema';
import { runSeed } from '../../db/seed';
import { paymentConfigSchema } from '@bravo/core';
import { saveSetting } from '../../modules/settings/settings.repo';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

const NOW = new Date('2026-10-20T12:00:00.000Z');
const STARTS = new Date('2026-10-27T13:00:00.000Z');
const ENDS = new Date('2026-10-27T15:00:00.000Z');

let roomId = '';

beforeEach(async () => {
  await runSeed(db);
  const [room] = await db.select().from(rooms).limit(1);
  roomId = room?.id ?? '';
});

const buildApp = (extraEnv: Record<string, string | undefined> = {}) =>
  createApp({ db, now: () => NOW, fetch: forbiddenFetch, env: testEnv(extraEnv) });

async function pendingCharge(overrides: Partial<typeof charges.$inferInsert> = {}) {
  const user = await createUser(db, { email: 'ana@bravoclinic.test' });
  const booking = await createBooking(db, {
    userId: user.id,
    roomId,
    startsAt: STARTS,
    endsAt: ENDS,
    status: 'awaiting_payment',
    totalCents: 21900,
    depositCents: 10950,
    paidCents: 0,
    holdExpiresAt: new Date('2026-10-20T12:15:00.000Z'),
  });
  const id = randomUUID();
  const [charge] = await db
    .insert(charges)
    .values({
      id,
      provider: 'sandbox',
      externalId: `sbx_${id}`,
      purpose: 'booking_deposit',
      method: 'pix',
      userId: user.id,
      bookingId: booking.id,
      amountCents: 10950,
      status: 'pending',
      pixCopyPaste: `00020126SANDBOX${id}`,
      expiresAt: new Date('2026-10-20T12:15:00.000Z'),
      idempotencyKey: `ch_${id}`,
      ...overrides,
    })
    .returning();
  if (charge === undefined) throw new Error('charge insert failed');
  return { user, booking, charge };
}

const bookingStatus = async (id: string) =>
  (await db.select().from(bookings).where(eq(bookings.id, id)))[0]?.status;

const decide = (
  app: ReturnType<typeof buildApp>,
  chargeId: string,
  action: 'approve' | 'reject',
  cookie?: string,
) =>
  send(app, 'POST', `/public/sandbox/charges/${chargeId}/${action}`, {
    body: {},
    ...(cookie !== undefined && { cookie }),
  });

describe('GET /public/sandbox/charges/:id (NUC-120)', () => {
  it('describes the charge for the hosted page, parsed by sandboxChargeSchema', async () => {
    const { charge, booking } = await pendingCharge();

    const res = await send(buildApp(), 'GET', `/public/sandbox/charges/${charge.id}`);

    expect(res.status).toBe(200);
    expect(sandboxChargeSchema.parse(res.body)).toEqual({
      id: charge.id,
      amountCents: 10950,
      method: 'pix',
      status: 'pending',
      purpose: 'booking_deposit',
      bookingCode: booking.code,
      bookingId: booking.id,
      expiresAt: '2026-10-20T12:15:00.000Z',
      pixCopyPaste: `00020126SANDBOX${charge.id}`,
    });
  });

  it('answers 404 for an unknown charge and for a charge of another provider', async () => {
    const { charge } = await pendingCharge({ provider: 'mercadopago', externalId: '999' });

    const other = await send(buildApp(), 'GET', `/public/sandbox/charges/${charge.id}`);
    const unknown = await send(buildApp(), 'GET', `/public/sandbox/charges/${randomUUID()}`);

    expect([other.status, unknown.status]).toEqual([404, 404]);
  });
});

describe('approve and reject on the hosted page (NUC-120)', () => {
  it('approve confirms the booking through a webhook_events row of provider sandbox', async () => {
    const { charge, booking } = await pendingCharge();

    const res = await decide(buildApp(), charge.id, 'approve');

    expect(res.status).toBe(200);
    expect(sandboxActionSchema.parse(res.body)).toEqual({ status: 'approved' });
    expect(await bookingStatus(booking.id)).toBe('confirmed');
    const events = await db.select().from(webhookEvents);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      provider: 'sandbox',
      externalId: `sbx_${charge.id}`,
      externalStatus: 'approved',
      signatureValid: true,
    });
    expect(events[0]?.processedAt).not.toBeNull();
  });

  it('answers 409 when the charge was already decided', async () => {
    const { charge } = await pendingCharge();
    const app = buildApp();
    await decide(app, charge.id, 'approve');

    const again = await decide(app, charge.id, 'approve');
    const reject = await decide(app, charge.id, 'reject');

    expect(again.status).toBe(409);
    expect(reject.status).toBe(409);
    expect(await db.select().from(webhookEvents)).toHaveLength(1);
  });

  it('reject marks the charge rejected and keeps the booking awaiting payment', async () => {
    const { charge, booking } = await pendingCharge();

    const res = await decide(buildApp(), charge.id, 'reject');

    expect(sandboxActionSchema.parse(res.body)).toEqual({ status: 'rejected' });
    expect(await bookingStatus(booking.id)).toBe('awaiting_payment');
  });

  it('answers 404 for an unknown charge and rejects a foreign origin', async () => {
    const { charge } = await pendingCharge();

    const unknown = await decide(buildApp(), randomUUID(), 'approve');
    const foreign = await send(buildApp(), 'POST', `/public/sandbox/charges/${charge.id}/approve`, {
      body: {},
      headers: { Origin: 'https://evil.example' },
    });

    expect(unknown.status).toBe(404);
    expect(foreign.status).toBe(403);
    expect(foreign.error?.code).toBe('CSRF_REJECTED');
  });

  it('writes an audit entry for the decision', async () => {
    const { charge } = await pendingCharge();

    await decide(buildApp(), charge.id, 'approve');

    const [entry] = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'payment.sandbox_approve'));
    expect(entry).toMatchObject({ entityType: 'charge', entityId: charge.id });
  });
});

describe('sandbox approval on production (NUC-121, AD-034, AD-037)', () => {
  const production = () => buildApp({ NEON_BRANCH: 'production' });

  it('lets staff without TOTP decide with a password-only session, but not a tenant who verified 2FA', async () => {
    const { charge, booking, user } = await pendingCharge();
    const tenantVerified = await loginAs(db, user, { mfaVerified: true, now: NOW });
    const reception = await createUser(db, { role: 'reception', email: 'rec@bravoclinic.test' });
    const cookie = await loginAs(db, reception, { now: NOW });

    const refused = await decide(production(), charge.id, 'approve', tenantVerified);
    expect(refused.status).toBe(403);
    expect(await bookingStatus(booking.id)).toBe('awaiting_payment');

    const res = await decide(production(), charge.id, 'approve', cookie);

    expect(res.status).toBe(200);
    expect(await bookingStatus(booking.id)).toBe('confirmed');
    const [entry] = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'payment.sandbox_approve'));
    expect(entry).toMatchObject({ actorUserId: reception.id, actorRole: 'reception' });
  });

  it('answers 403 to an anonymous visitor and writes nothing', async () => {
    const { charge, booking } = await pendingCharge();

    const res = await decide(production(), charge.id, 'approve');

    expect(res.status).toBe(403);
    expect(res.error?.code).toBe('FORBIDDEN');
    expect(await bookingStatus(booking.id)).toBe('awaiting_payment');
    expect(await db.select().from(webhookEvents)).toHaveLength(0);
  });

  it('answers 403 to a tenant, and to staff with TOTP whose session is not MFA-verified', async () => {
    const { charge, user } = await pendingCharge();
    const tenantCookie = await loginAs(db, user, { now: NOW });
    const admin = await createUser(db, {
      role: 'admin',
      totp: true,
      email: 'adm@bravoclinic.test',
    });
    const noMfa = await loginAs(db, admin, { now: NOW });

    for (const cookie of [tenantCookie, noMfa]) {
      const res = await decide(production(), charge.id, 'approve', cookie);
      expect(res.status).toBe(403);
    }
    expect((await db.select().from(charges).where(eq(charges.id, charge.id)))[0]?.status).toBe(
      'pending',
    );
  });

  it('lets an MFA-verified admin or reception approve, and audits who did', async () => {
    const first = await pendingCharge();
    const admin = await createUser(db, {
      role: 'admin',
      totp: true,
      email: 'adm@bravoclinic.test',
    });
    const cookie = await loginAs(db, admin, { mfaVerified: true, now: NOW });

    const res = await decide(production(), first.charge.id, 'approve', cookie);

    expect(res.status).toBe(200);
    expect(await bookingStatus(first.booking.id)).toBe('confirmed');
    const [entry] = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'payment.sandbox_approve'));
    expect(entry).toMatchObject({ actorUserId: admin.id, actorRole: 'admin' });
  });
});

describe('GET /public/payment-config (NUC-129)', () => {
  it('returns the sandbox with no public key', async () => {
    const res = await send(buildApp(), 'GET', '/public/payment-config');

    expect(res.status).toBe(200);
    expect(paymentConfigSchema.parse(res.body)).toEqual({
      provider: 'sandbox',
      publicKey: null,
      environment: 'test',
    });
  });

  it('returns the Mercado Pago public key and environment, never a secret', async () => {
    await withTransaction(db, (tx) =>
      saveSetting(tx, 'payment.active_gateway', 'mercadopago', null),
    );
    await db.insert(integrationSettings).values({
      key: 'gateway.mercadopago',
      environment: 'production',
      config: { publicKey: 'APP_USR-public-1', accessToken: 'must-not-leak' },
    });

    const res = await send(buildApp(), 'GET', '/public/payment-config');

    expect(paymentConfigSchema.parse(res.body)).toEqual({
      provider: 'mercadopago',
      publicKey: 'APP_USR-public-1',
      environment: 'production',
    });
    expect(JSON.stringify(res.body)).not.toContain('must-not-leak');
  });
});
