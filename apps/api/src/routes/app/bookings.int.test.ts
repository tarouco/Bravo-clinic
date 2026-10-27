import { randomUUID } from 'node:crypto';
import { bookingDetailSchema } from '@bravo/core';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTenant, seededRoom } from '../../../test/booking-helpers';
import { createBooking as insertBooking, createUser } from '../../../test/factories';
import { forbiddenFetch, send, testEnv } from '../../../test/http';
import { requireTestDatabaseUrl } from '../../../test/require-test-db';
import { createApp } from '../../app';
import { createDb, withTransaction } from '../../db/client';
import {
  bookingEvents,
  bookingSegments,
  bookings,
  charges,
  consents,
  emailOutbox,
} from '../../db/schema';
import { runSeed } from '../../db/seed';
import { createRegistry, type CheckoutStep, type Registry } from '../../extensions/registry';
import { createClosedDays } from '../../modules/calendar/exceptions.service';
import { saveSetting } from '../../modules/settings/settings.repo';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

const NOW = new Date('2026-10-20T12:00:00.000Z');
// Tuesday 2026-10-27, W-PR PR-3: 17:30-20:00 = 12000 + 9900 = 21900 (local 17:30 = 20:30Z).
const PR3 = { roomSlug: 'principal', date: '2026-10-27', startMinute: 1050, endMinute: 1200 };

let registry: Registry;

beforeEach(async () => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  await runSeed(db);
  await withTransaction(db, (tx) => saveSetting(tx, 'onboarding.prices_reviewed', true, null));
  registry = createRegistry();
});

const buildApp = (override: Partial<Registry> = {}) =>
  createApp({
    db,
    now: () => NOW,
    fetch: forbiddenFetch,
    env: testEnv(),
    registry: createRegistry({ ...registry, ...override }),
  });

interface BookArgs {
  cookie: string;
  body?: Record<string, unknown>;
  key?: string | null;
  app?: ReturnType<typeof buildApp>;
  headers?: Record<string, string>;
}

const book = ({ cookie, body, key = randomUUID(), app = buildApp(), headers = {} }: BookArgs) =>
  send(app, 'POST', '/app/bookings', {
    cookie,
    body: { ...PR3, acceptPolicy: true, policyVersion: 1, expectedTotalCents: 21900, ...body },
    headers: { ...(key !== null && { 'Idempotency-Key': key }), ...headers },
  });

const details = (res: { error?: { details?: unknown } | undefined }) =>
  res.error?.details as Record<string, unknown> | undefined;

describe('POST /app/bookings: guards (NUC-89..NUC-92)', () => {
  it('answers 403 EMAIL_NOT_VERIFIED for an unverified e-mail and creates nothing', async () => {
    const { cookie } = await createTenant(db, { verified: false, now: NOW });

    const res = await book({ cookie });

    expect(res.status).toBe(403);
    expect(res.error?.code).toBe('EMAIL_NOT_VERIFIED');
    expect(await db.select().from(bookings)).toHaveLength(0);
  });

  it('answers 422 PROFILE_INCOMPLETE without CPF/CNPJ with the spec message', async () => {
    const { cookie } = await createTenant(db, { document: false, now: NOW });

    const res = await book({ cookie });

    expect(res.status).toBe(422);
    expect(res.error?.code).toBe('PROFILE_INCOMPLETE');
    expect(res.error?.message).toBe('Complete seu cadastro com CPF ou CNPJ para reservar.');
  });

  it('answers 409 BOOKING_NOT_OPEN to a tenant while prices are not reviewed', async () => {
    await withTransaction(db, (tx) => saveSetting(tx, 'onboarding.prices_reviewed', false, null));
    const { cookie } = await createTenant(db, { now: NOW });

    const res = await book({ cookie });

    expect(res.status).toBe(409);
    expect(res.error?.code).toBe('BOOKING_NOT_OPEN');
    expect(res.error?.message).toBe('As reservas online abrem em breve.');
    expect(await db.select().from(bookings)).toHaveLength(0);
  });

  it('answers 422 when the policy is not accepted and creates nothing', async () => {
    const { cookie } = await createTenant(db, { now: NOW });

    const res = await book({ cookie, body: { acceptPolicy: false } });

    expect(res.status).toBe(422);
    expect(res.error?.code).toBe('VALIDATION_FAILED');
    expect(await db.select().from(bookings)).toHaveLength(0);
  });

  it('answers 409 POLICY_CHANGED when the accepted version is not the current one', async () => {
    await withTransaction(db, (tx) => saveSetting(tx, 'policy.version', 2, null));
    const { cookie } = await createTenant(db, { now: NOW });

    const res = await book({ cookie, body: { policyVersion: 1 } });

    expect(res.status).toBe(409);
    expect(res.error?.code).toBe('POLICY_CHANGED');
    expect(await db.select().from(bookings)).toHaveLength(0);
  });

  it('answers 409 PRICE_CHANGED with the fresh quote when the expected total is stale', async () => {
    const { cookie } = await createTenant(db, { now: NOW });

    const res = await book({ cookie, body: { expectedTotalCents: 20000 } });

    expect(res.status).toBe(409);
    expect(res.error?.code).toBe('PRICE_CHANGED');
    const quote = details(res)?.['quote'] as { netCents: number; policyVersion: number };
    expect(quote.netCents).toBe(21900);
    expect(quote.policyVersion).toBe(1);
    expect(await db.select().from(bookings)).toHaveLength(0);
  });

  it('answers 422 SLOT_UNAVAILABLE with the reason for an interval outside the opening hours', async () => {
    const { cookie } = await createTenant(db, { now: NOW });

    const res = await book({
      cookie,
      body: { startMinute: 360, endMinute: 420, expectedTotalCents: 9700 },
    });

    expect(res.status).toBe(422);
    expect(res.error?.code).toBe('SLOT_UNAVAILABLE');
    expect(details(res)?.['reason']).toBe('outside_hours');
  });
});

describe('POST /app/bookings: creation (NUC-93, NUC-94)', () => {
  it('creates the PR-3 booking: 201 awaiting_payment with hold, occupancy, segments, snapshot and consent', async () => {
    const { user, cookie } = await createTenant(db, { now: NOW });
    const room = await seededRoom(db);

    const res = await book({ cookie, headers: { 'X-Forwarded-For': '203.0.113.7, 10.0.0.1' } });

    expect(res.status).toBe(201);
    const detail = bookingDetailSchema.parse(res.body);
    expect(detail.status).toBe('awaiting_payment');
    expect(detail.holdExpiresAt).toBe('2026-10-20T12:15:00.000Z');
    expect(detail.code).toMatch(/^BRV-[A-Z2-7]{6}$/);
    expect(detail.totalCents).toBe(21900);
    expect(detail.depositCents).toBe(10950);
    expect(detail.paidCents).toBe(0);
    expect(detail.segments.map((s) => [s.startMinute, s.endMinute, s.amountCents])).toEqual([
      [1050, 1140, 12000],
      [1140, 1200, 9900],
    ]);
    expect(detail.actions.canPay).toBe(true);

    const [row] = await db.select().from(bookings).where(eq(bookings.id, detail.id));
    expect(row).toMatchObject({
      userId: user.id,
      roomId: room.id,
      paymentMode: 'deposit_balance',
      cleanupMinutes: 30,
      source: 'web',
    });
    expect(row?.startsAt.toISOString()).toBe('2026-10-27T20:30:00.000Z');
    expect(row?.endsAt.toISOString()).toBe('2026-10-27T23:00:00.000Z');
    expect(row?.balanceChargeAt?.toISOString()).toBe('2026-10-25T20:30:00.000Z');
    expect(row?.balanceDueAt?.toISOString()).toBe('2026-10-26T20:30:00.000Z');
    expect((row?.policySnapshot as Record<string, unknown>)['policy.version']).toBe(1);
    expect(row?.icsUid).toMatch(/@bravoclinic$/);
    expect(await db.select().from(bookingSegments)).toHaveLength(2);

    const { rows: periods } = await pool.query<{ until: Date }>(
      `select upper(period) as until from room_occupancy where ref_id = $1 and active`,
      [detail.id],
    );
    expect(periods.map((p) => p.until.toISOString())).toEqual(['2026-10-27T23:30:00.000Z']);

    const [consent] = await db.select().from(consents).where(eq(consents.refId, detail.id));
    expect(consent).toMatchObject({
      userId: user.id,
      kind: 'booking_policy',
      version: 'policy-v1',
      refType: 'booking',
      ip: '203.0.113.7',
    });
    const events = await db.select().from(bookingEvents);
    expect(events.map((e) => [e.fromStatus, e.toStatus, e.reason])).toEqual([
      [null, 'awaiting_payment', 'created'],
    ]);
  });

  it('lets exactly one of ten concurrent requests for the same slot win; the others get 409 SLOT_TAKEN', async () => {
    const tenants = await Promise.all(
      Array.from({ length: 10 }, () => createTenant(db, { now: NOW })),
    );
    const app = buildApp();

    const results = await Promise.all(tenants.map(({ cookie }) => book({ cookie, app })));

    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409, 409, 409, 409, 409, 409, 409, 409, 409]);
    expect(
      results.filter((r) => r.status === 409).every((r) => r.error?.code === 'SLOT_TAKEN'),
    ).toBe(true);
    expect(await db.select().from(bookings)).toHaveLength(1);
  });

  it('answers 429 to the fourth awaiting_payment hold of a tenant', async () => {
    const { cookie } = await createTenant(db, { now: NOW });
    const hour = (n: number) => ({
      startMinute: 540 + n * 120,
      endMinute: 600 + n * 120,
      expectedTotalCents: 9700,
    });

    const first = await Promise.all([0, 1, 2].map((n) => book({ cookie, body: hour(n) })));
    const fourth = await book({ cookie, body: hour(3) });

    expect(first.map((r) => r.status)).toEqual([201, 201, 201]);
    expect(fourth.status).toBe(429);
    expect(fourth.error?.code).toBe('TOO_MANY_ATTEMPTS');
    expect(fourth.error?.message).toBe('Você já tem 3 reservas aguardando pagamento.');
    expect(await db.select().from(bookings)).toHaveLength(3);
  });

  it('expires a stale hold over the slot in the same transaction and creates the new booking', async () => {
    const room = await seededRoom(db);
    const other = await createUser(db);
    const stale = await insertBooking(db, {
      userId: other.id,
      roomId: room.id,
      startsAt: new Date('2026-10-27T20:30:00.000Z'),
      endsAt: new Date('2026-10-27T23:00:00.000Z'),
      status: 'awaiting_payment',
      totalCents: 21900,
      paidCents: 0,
      holdExpiresAt: new Date('2026-10-20T11:50:00.000Z'),
    });
    const { cookie } = await createTenant(db, { now: NOW });

    const res = await book({ cookie });

    expect(res.status).toBe(201);
    const [old] = await db.select().from(bookings).where(eq(bookings.id, stale.id));
    expect(old?.status).toBe('expired');
    const { rows: active } = await pool.query(
      `select 1 from room_occupancy where ref_id = $1 and active`,
      [stale.id],
    );
    expect(active).toHaveLength(0);
    const events = await db
      .select()
      .from(bookingEvents)
      .where(eq(bookingEvents.bookingId, stale.id));
    expect(events.map((e) => [e.fromStatus, e.toStatus, e.reason])).toContainEqual([
      'awaiting_payment',
      'expired',
      'hold_expired',
    ]);
  });

  it('keeps a live hold: another tenant gets 409 SLOT_TAKEN', async () => {
    const room = await seededRoom(db);
    const other = await createUser(db);
    await insertBooking(db, {
      userId: other.id,
      roomId: room.id,
      startsAt: new Date('2026-10-27T20:30:00.000Z'),
      endsAt: new Date('2026-10-27T23:00:00.000Z'),
      status: 'awaiting_payment',
      paidCents: 0,
      holdExpiresAt: new Date('2026-10-20T12:10:00.000Z'),
    });
    const { cookie } = await createTenant(db, { now: NOW });

    const res = await book({ cookie });

    expect(res.status).toBe(409);
    expect(res.error?.code).toBe('SLOT_TAKEN');
    expect(res.error?.message).toBe('Este horário acabou de ser reservado.');
  });
});

describe('POST /app/bookings: zero amount to pay now (NUC-207, NUC-104, NUC-205)', () => {
  it('confirms at once without a charge when a credit step covers the sinal, and persists the steps', async () => {
    const persisted: string[] = [];
    const creditStep: CheckoutStep = {
      name: 'credit',
      order: 400,
      apply: (_ctx, draft) => Promise.resolve({ ...draft, creditAvailableCents: 10950 }),
      persist: (_tx, booking) => {
        persisted.push(booking.code);
        return Promise.resolve();
      },
    };
    const notifyStaff = vi.fn(() => Promise.resolve());
    const app = buildApp({
      checkoutSteps: [creditStep],
      notifications: { notifyStaff },
    });
    const { cookie } = await createTenant(db, { now: NOW });

    const res = await book({ cookie, body: { useCredits: true }, app });

    expect(res.status).toBe(201);
    const detail = bookingDetailSchema.parse(res.body);
    expect(detail).toMatchObject({
      status: 'confirmed',
      holdExpiresAt: null,
      paidCents: 10950,
      balanceCents: 10950,
      creditAppliedCents: 10950,
    });
    expect(await db.select().from(charges)).toHaveLength(0);
    const mails = await db.select().from(emailOutbox);
    expect(mails.map((m) => m.template)).toEqual(['booking.confirmed']);
    expect(persisted).toEqual([detail.code]);
    expect(notifyStaff).toHaveBeenCalledWith('new_booking', {
      entityId: detail.id,
      code: detail.code,
    });
  });
});

describe('POST /app/bookings versus closing the date (NUC-51)', () => {
  it('never leaves a booking missing from AFFECTED_BOOKINGS and not rejected as closed', async () => {
    const { cookie } = await createTenant(db, { now: NOW });
    const admin = await createUser(db, { role: 'admin' });
    const ctx = {
      actorUserId: admin.id,
      actorRole: 'admin',
      origin: 'admin' as const,
      ip: null,
      requestId: null,
    };

    const [close, booking] = await Promise.all([
      withTransaction(db, (tx) =>
        createClosedDays(tx, { date: '2026-10-27', roomIds: null }, ctx, registry, NOW),
      ).then(
        () => ({ closed: true as const }),
        (error: { code?: string; details?: { bookings?: { code: string }[] } }) => ({
          closed: false as const,
          error,
        }),
      ),
      book({ cookie }),
    ]);

    if (close.closed) {
      expect(booking.status).toBe(422);
      expect(details(booking)?.['reason']).toBe('closed');
      expect(await db.select().from(bookings)).toHaveLength(0);
    } else {
      expect(close.error.code).toBe('AFFECTED_BOOKINGS');
      expect(booking.status).toBe(201);
      const [row] = await db.select().from(bookings);
      expect(close.error.details?.bookings?.map((b) => b.code)).toEqual([row?.code]);
    }
  });
});
