import { randomUUID } from 'node:crypto';
import {
  bookingDetailSchema,
  localToUtc,
  rescheduleQuoteSchema,
  type LocalDate,
} from '@bravo/core';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTenant, seededRoom } from '../../../test/booking-helpers';
import { createBooking as insertBooking, createUser } from '../../../test/factories';
import { forbiddenFetch, send, testEnv } from '../../../test/http';
import { requireTestDatabaseUrl } from '../../../test/require-test-db';
import { createApp } from '../../app';
import { createDb } from '../../db/client';
import {
  blocks,
  bookingEvents,
  bookingRescheduleRequests,
  bookings,
  charges,
  emailOutbox,
  refunds,
} from '../../db/schema';
import { runSeed } from '../../db/seed';
import { createRegistry } from '../../extensions/registry';
import { applyProviderStatus } from '../../modules/payments/payment-effects.service';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

const NOW = new Date('2026-10-20T12:00:00.000Z');
const TUE = '2026-10-27' as LocalDate;
const WED = '2026-10-28' as LocalDate;
const at = (date: LocalDate, minute: number) => localToUtc(date, minute);

let roomId = '';

beforeEach(async () => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  await runSeed(db);
  roomId = (await seededRoom(db)).id;
});

const buildApp = () => createApp({ db, now: () => NOW, fetch: forbiddenFetch, env: testEnv() });
const paymentDeps = () => ({
  db,
  env: testEnv(),
  fetch: forbiddenFetch,
  now: () => NOW,
  registry: createRegistry(),
});

/** Tuesday 14:00 for `hours` hours, priced as the W-ST examples need. */
const bookingOf = (
  userId: string,
  options: { hours: number; total: number; paid: number; deposit: number; status?: string },
) =>
  insertBooking(db, {
    userId,
    roomId,
    startsAt: at(TUE, 840),
    endsAt: at(TUE, 840 + options.hours * 60),
    status: options.status ?? 'confirmed',
    totalCents: options.total,
    paidCents: options.paid,
    depositCents: options.deposit,
  });

const move = (
  cookie: string,
  id: string,
  body: Record<string, unknown>,
  path = 'reschedule',
  key: string | null = randomUUID(),
) =>
  send(buildApp(), 'POST', `/app/bookings/${id}/${path}`, {
    cookie,
    body,
    ...(key !== null && path === 'reschedule' && { headers: { 'Idempotency-Key': key } }),
  });

const wed1h = { date: WED, startMinute: 840, endMinute: 900 };
const wed3h = { date: WED, startMinute: 840, endMinute: 1020 };

const events = (bookingId: string) =>
  db.select().from(bookingEvents).where(eq(bookingEvents.bookingId, bookingId));
const occupancyUpper = async (bookingId: string) => {
  const { rows } = await pool.query<{ until: Date }>(
    `select upper(period) as until from room_occupancy where ref_id = $1 and active`,
    [bookingId],
  );
  return rows.map((r) => r.until.toISOString());
};

describe('POST /app/bookings/:id/reschedule/quote (NUC-142)', () => {
  it('returns the settlement of ST-1: credit 14300 for a 1 h slot after a paid 3 h booking', async () => {
    const { user, cookie } = await createTenant(db, { now: NOW });
    const row = await bookingOf(user.id, {
      hours: 3,
      total: 24000,
      paid: 24000,
      deposit: 12000,
      status: 'paid',
    });

    const res = await move(cookie, row.id, wed1h, 'reschedule/quote');

    expect(res.status).toBe(200);
    const quote = rescheduleQuoteSchema.parse(res.body);
    expect(quote).toMatchObject({ allowed: true, reason: null, message: null });
    expect(quote.newQuote?.netCents).toBe(9700);
    expect(quote.settlement).toEqual({
      payNowCents: 0,
      creditCents: 14300,
      newTotalCents: 9700,
      newBalanceCents: 0,
    });
    expect(
      (await db.select().from(bookings).where(eq(bookings.id, row.id)))[0]?.rescheduleCount,
    ).toBe(0);
  });

  it('returns the settlement of ST-3: 14300 to pay now for a dearer slot', async () => {
    const { user, cookie } = await createTenant(db, { now: NOW });
    const row = await bookingOf(user.id, { hours: 1, total: 9700, paid: 4851, deposit: 4851 });

    const quote = rescheduleQuoteSchema.parse(
      (await move(cookie, row.id, wed3h, 'reschedule/quote')).body,
    );

    expect(quote.allowed).toBe(true);
    expect(quote.settlement).toEqual({
      payNowCents: 14300,
      creditCents: 0,
      newTotalCents: 24000,
      newBalanceCents: 4849,
    });
  });

  it('reports the refusal reason instead of failing: RS-3 limit_reached', async () => {
    const { user, cookie } = await createTenant(db, { now: NOW });
    const row = await bookingOf(user.id, { hours: 1, total: 9700, paid: 4851, deposit: 4851 });
    await db.update(bookings).set({ rescheduleCount: 1 }).where(eq(bookings.id, row.id));

    const quote = rescheduleQuoteSchema.parse(
      (await move(cookie, row.id, wed1h, 'reschedule/quote')).body,
    );

    expect(quote).toMatchObject({
      allowed: false,
      reason: 'limit_reached',
      newQuote: null,
      settlement: null,
    });
    expect(quote.message).toContain('reagendamento cortesia');
  });

  it('reports an occupied target: in_cleanup, and the write path answers 422 SLOT_UNAVAILABLE (CL-1)', async () => {
    const { user, cookie } = await createTenant(db, { now: NOW });
    const row = await bookingOf(user.id, { hours: 1, total: 9700, paid: 4851, deposit: 4851 });
    const other = await createUser(db);
    await insertBooking(db, {
      userId: other.id,
      roomId,
      startsAt: at(WED, 540),
      endsAt: at(WED, 660),
    });
    const target = { date: WED, startMinute: 660, endMinute: 720 };

    const quote = rescheduleQuoteSchema.parse(
      (await move(cookie, row.id, target, 'reschedule/quote')).body,
    );
    const res = await move(cookie, row.id, target);

    expect(quote).toMatchObject({
      allowed: false,
      reason: 'in_cleanup',
      message: 'Sala em limpeza',
    });
    expect(res.status).toBe(422);
    expect(res.error?.code).toBe('SLOT_UNAVAILABLE');
    expect((res.error?.details as unknown as { reason: string }).reason).toBe('in_cleanup');
  });
});

describe('POST /app/bookings/:id/reschedule: policy (NUC-143, NUC-148)', () => {
  it('answers 422 POLICY_VIOLATION too_late at 23 h 59 min (RS-2)', async () => {
    const { user, cookie } = await createTenant(db, { now: NOW });
    const row = await insertBooking(db, {
      userId: user.id,
      roomId,
      startsAt: new Date(NOW.getTime() + 24 * 3_600_000 - 60_000),
      endsAt: new Date(NOW.getTime() + 25 * 3_600_000 - 60_000),
    });

    const res = await move(cookie, row.id, wed1h);

    expect(res.status).toBe(422);
    expect(res.error?.code).toBe('POLICY_VIOLATION');
    expect((res.error?.details as unknown as { reason: string }).reason).toBe('too_late');
  });

  it('answers 422 POLICY_VIOLATION limit_reached when the free reschedule was used (RS-3)', async () => {
    const { user, cookie } = await createTenant(db, { now: NOW });
    const row = await bookingOf(user.id, { hours: 1, total: 9700, paid: 4851, deposit: 4851 });
    await db.update(bookings).set({ rescheduleCount: 1 }).where(eq(bookings.id, row.id));

    const res = await move(cookie, row.id, wed1h);

    expect(res.status).toBe(422);
    expect((res.error?.details as unknown as { reason: string }).reason).toBe('limit_reached');
  });

  it('answers 422 POLICY_VIOLATION beyond_window for a date 61 days ahead (RS-4)', async () => {
    const { user, cookie } = await createTenant(db, { now: NOW });
    const row = await bookingOf(user.id, { hours: 1, total: 9700, paid: 4851, deposit: 4851 });

    const res = await move(cookie, row.id, {
      date: '2026-12-21',
      startMinute: 840,
      endMinute: 900,
    });

    expect(res.status).toBe(422);
    expect((res.error?.details as unknown as { reason: string }).reason).toBe('beyond_window');
  });

  it('answers 422 POLICY_VIOLATION unsupported_payment_mode for a package booking without a handler', async () => {
    const { user, cookie } = await createTenant(db, { now: NOW });
    const row = await insertBooking(db, {
      userId: user.id,
      roomId,
      startsAt: at(TUE, 840),
      endsAt: at(TUE, 900),
      paymentMode: 'package',
    });

    const res = await move(cookie, row.id, wed1h);

    expect(res.status).toBe(422);
    expect(res.error?.code).toBe('POLICY_VIOLATION');
    expect((res.error?.details as unknown as { reason: string }).reason).toBe(
      'unsupported_payment_mode',
    );
  });

  it('answers 404 for a booking of another user', async () => {
    const owner = await createTenant(db, { now: NOW });
    const other = await createTenant(db, { now: NOW });
    const row = await bookingOf(owner.user.id, {
      hours: 1,
      total: 9700,
      paid: 4851,
      deposit: 4851,
    });

    const res = await move(other.cookie, row.id, wed1h);

    expect(res.status).toBe(404);
  });
});

describe('POST /app/bookings/:id/reschedule: equal or cheaper slot (NUC-144, NUC-145)', () => {
  it('moves at once for ST-2: credit 2300 recorded as a deferred grant, sequence and count bumped', async () => {
    const { user, cookie } = await createTenant(db, { now: NOW });
    const row = await bookingOf(user.id, { hours: 3, total: 24000, paid: 12000, deposit: 12000 });

    const res = await move(cookie, row.id, wed1h);

    expect(res.status).toBe(200);
    const body = res.body as { creditCents: number };
    expect(body.creditCents).toBe(2300);
    const detail = bookingDetailSchema.parse(body);
    expect(detail).toMatchObject({
      status: 'paid',
      totalCents: 9700,
      paidCents: 9700,
      balanceCents: 0,
      depositCents: 9700,
      rescheduleCount: 1,
    });
    expect(detail.segments.map((s) => [s.startMinute, s.endMinute, s.amountCents])).toEqual([
      [840, 900, 9700],
    ]);
    const [stored] = await db.select().from(bookings).where(eq(bookings.id, row.id));
    expect(stored?.icsSequence).toBe(1);
    expect(stored?.startsAt.toISOString()).toBe(at(WED, 840).toISOString());
    expect(await occupancyUpper(row.id)).toEqual([at(WED, 930).toISOString()]);
    const history = await events(row.id);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      fromStatus: 'confirmed',
      toStatus: 'paid',
      reason: 'rescheduled',
    });
    expect((history[0]?.data as { creditGrant: unknown }).creditGrant).toEqual({
      amountCents: 2300,
      status: 'deferred',
    });
    const mails = await db.select().from(emailOutbox);
    expect(mails.map((m) => m.template)).toEqual(['booking.rescheduled']);
  });

  it('keeps an unpaid balance when only the sinal was paid (ST-5 shape): no credit, status unchanged', async () => {
    const { user, cookie } = await createTenant(db, { now: NOW });
    const row = await bookingOf(user.id, { hours: 2, total: 16000, paid: 8000, deposit: 8000 });
    // 1 h 30 on Wednesday uses the "1 hora" rate: 14550, below the 16000 of the old slot.
    const res = await move(cookie, row.id, { date: WED, startMinute: 840, endMinute: 960 });

    expect(res.status).toBe(200);
    const detail = bookingDetailSchema.parse(res.body);
    expect(detail.status).toBe('confirmed');
    expect((res.body as { creditCents: number }).creditCents).toBe(0);
    expect(detail.paidCents).toBe(8000);
    expect(detail.balanceCents).toBe(detail.totalCents - 8000);
    const [stored] = await db.select().from(bookings).where(eq(bookings.id, row.id));
    expect(stored?.balanceDueAt).not.toBeNull();
  });

  it('can move to a slot that overlaps its own current one (a 30 min shift)', async () => {
    const { user, cookie } = await createTenant(db, { now: NOW });
    const row = await bookingOf(user.id, { hours: 2, total: 16000, paid: 8000, deposit: 8000 });

    const res = await move(cookie, row.id, { date: TUE, startMinute: 870, endMinute: 990 });

    expect(res.status).toBe(200);
    expect(await occupancyUpper(row.id)).toEqual([at(TUE, 1020).toISOString()]);
  });
});

describe('POST /app/bookings/:id/reschedule: dearer slot (NUC-146, NUC-147)', () => {
  const dearerBooking = async () => {
    const tenant = await createTenant(db, { now: NOW });
    const row = await bookingOf(tenant.user.id, {
      hours: 1,
      total: 9700,
      paid: 4851,
      deposit: 4851,
    });
    return { ...tenant, row };
  };

  it('answers 422 for the missing payment method before writing anything', async () => {
    const { cookie, row } = await dearerBooking();

    const res = await move(cookie, row.id, wed3h);

    expect(res.status).toBe(422);
    expect(res.error?.code).toBe('VALIDATION_FAILED');
    expect(await db.select().from(bookingRescheduleRequests)).toHaveLength(0);
  });

  it('holds the new slot, creates the 14300 difference charge and leaves the booking as it was (ST-3)', async () => {
    const { cookie, row } = await dearerBooking();

    const res = await move(cookie, row.id, { ...wed3h, method: 'pix' });

    expect(res.status).toBe(202);
    const body = res.body as {
      rescheduleRequestId: string;
      expiresAt: string;
      charge: { chargeId: string; amountCents: number; method: string; status: string };
    };
    expect(body.expiresAt).toBe('2026-10-20T12:15:00.000Z');
    expect(body.charge).toMatchObject({ amountCents: 14300, method: 'pix', status: 'pending' });
    const [request] = await db.select().from(bookingRescheduleRequests);
    expect(request).toMatchObject({
      id: body.rescheduleRequestId,
      bookingId: row.id,
      payNowCents: 14300,
      status: 'pending',
      chargeId: body.charge.chargeId,
    });
    const [charge] = await db.select().from(charges);
    expect(charge).toMatchObject({
      purpose: 'booking_difference',
      bookingId: row.id,
      amountCents: 14300,
    });
    const [block] = await db
      .select()
      .from(blocks)
      .where(eq(blocks.id, request?.holdBlockId ?? ''));
    expect(block?.tag).toBe('Reagendamento em pagamento');
    expect(block?.startsAt.toISOString()).toBe(at(WED, 840).toISOString());
    expect(block?.cancelledAt).toBeNull();
    const [stored] = await db.select().from(bookings).where(eq(bookings.id, row.id));
    expect(stored).toMatchObject({ rescheduleCount: 0, totalCents: 9700, paidCents: 4851 });
    expect(stored?.startsAt.toISOString()).toBe(at(TUE, 840).toISOString());
    const detail = bookingDetailSchema.parse(
      (await send(buildApp(), 'GET', `/app/bookings/${row.id}`, { cookie })).body,
    );
    expect(detail.pendingReschedule).toMatchObject({
      id: body.rescheduleRequestId,
      payNowCents: 14300,
      chargeId: body.charge.chargeId,
    });
  });

  it('applies the move when the charge is approved: paid 19151, balance 4849, hold released', async () => {
    const { cookie, row } = await dearerBooking();
    const res = await move(cookie, row.id, { ...wed3h, method: 'pix' });
    const chargeId = (res.body as { charge: { chargeId: string } }).charge.chargeId;

    await applyProviderStatus(paymentDeps(), {
      provider: 'sandbox',
      chargeId,
      status: 'approved',
      amountCents: 14300,
    });

    const [stored] = await db.select().from(bookings).where(eq(bookings.id, row.id));
    expect(stored).toMatchObject({
      status: 'confirmed',
      totalCents: 24000,
      paidCents: 19151,
      balanceCents: 4849,
      depositCents: 4851,
      rescheduleCount: 1,
      icsSequence: 1,
    });
    expect(stored?.startsAt.toISOString()).toBe(at(WED, 840).toISOString());
    const [request] = await db.select().from(bookingRescheduleRequests);
    expect(request?.status).toBe('applied');
    expect(request?.appliedAt).not.toBeNull();
    const [block] = await db.select().from(blocks);
    expect(block?.cancelledAt).not.toBeNull();
    expect(await occupancyUpper(row.id)).toEqual([at(WED, 1050).toISOString()]);
    expect((await db.select().from(emailOutbox)).map((m) => m.template)).toContain(
      'booking.rescheduled',
    );
  });

  it('refunds the 14300 when the approval arrives after the slot was taken', async () => {
    const { cookie, row } = await dearerBooking();
    const res = await move(cookie, row.id, { ...wed3h, method: 'pix' });
    const chargeId = (res.body as { charge: { chargeId: string } }).charge.chargeId;
    // What the expiry job does, then another customer takes the slot.
    const [request] = await db.select().from(bookingRescheduleRequests);
    await db
      .update(bookingRescheduleRequests)
      .set({ status: 'expired' })
      .where(eq(bookingRescheduleRequests.id, request?.id ?? ''));
    await db.update(blocks).set({ cancelledAt: NOW });
    await pool.query(`update room_occupancy set active = false where kind = 'block'`);
    const other = await createUser(db);
    await insertBooking(db, {
      userId: other.id,
      roomId,
      startsAt: at(WED, 840),
      endsAt: at(WED, 1020),
    });

    await applyProviderStatus(paymentDeps(), {
      provider: 'sandbox',
      chargeId,
      status: 'approved',
      amountCents: 14300,
    });

    const [stored] = await db.select().from(bookings).where(eq(bookings.id, row.id));
    expect(stored).toMatchObject({ rescheduleCount: 0, totalCents: 9700, paidCents: 4851 });
    expect(stored?.startsAt.toISOString()).toBe(at(TUE, 840).toISOString());
    const [refund] = await db.select().from(refunds);
    expect(refund).toMatchObject({ chargeId, amountCents: 14300, bookingId: row.id });
    const [after] = await db.select().from(bookingRescheduleRequests);
    expect(after?.status).toBe('refunded');
    expect((await db.select().from(emailOutbox)).map((m) => m.template)).toContain(
      'booking.late_approval_refund',
    );
  });

  it('releases the hold block and cancels the request when the difference charge is rejected', async () => {
    const { cookie, row } = await dearerBooking();
    const res = await move(cookie, row.id, { ...wed3h, method: 'pix' });
    const chargeId = (res.body as { charge: { chargeId: string } }).charge.chargeId;

    await applyProviderStatus(paymentDeps(), { provider: 'sandbox', chargeId, status: 'rejected' });

    const [request] = await db.select().from(bookingRescheduleRequests);
    expect(request?.status).toBe('cancelled');
    const [block] = await db.select().from(blocks);
    expect(block?.cancelledAt).not.toBeNull();
    const [stored] = await db.select().from(bookings).where(eq(bookings.id, row.id));
    expect(stored?.rescheduleCount).toBe(0);
  });

  it('replaces an unpaid request when the customer tries again', async () => {
    const { cookie, row } = await dearerBooking();
    const first = await move(cookie, row.id, { ...wed3h, method: 'pix' });
    const second = await move(cookie, row.id, { ...wed3h, method: 'pix' });

    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    const requests = await db.select().from(bookingRescheduleRequests);
    expect(requests.map((r) => r.status).sort()).toEqual(['cancelled', 'pending']);
    const firstChargeId = (first.body as { charge: { chargeId: string } }).charge.chargeId;
    const [oldCharge] = await db.select().from(charges).where(eq(charges.id, firstChargeId));
    expect(oldCharge?.status).toBe('cancelled');
    expect((await db.select().from(blocks)).filter((b) => b.cancelledAt === null)).toHaveLength(1);
  });
});
