import { randomUUID } from 'node:crypto';
import {
  availabilityDaySchema,
  localToUtc,
  quoteSchema,
  revenueQuoteSchema,
  type LocalDate,
} from '@bravo/core';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCharge, createStaff, createTenant, seededRoom } from '../../../test/booking-helpers';
import { createBooking as insertBooking } from '../../../test/factories';
import {
  createCoupon,
  createCreditLot,
  createHourPackageCategory,
  createSubscription,
} from '../../../test/factories/revenue';
import { forbiddenFetch, send, testEnv } from '../../../test/http';
import { requireTestDatabaseUrl } from '../../../test/require-test-db';
import { createApp } from '../../app';
import { createDb, withTransaction } from '../../db/client';
import {
  bookingEvents,
  bookings,
  charges,
  couponUses,
  coupons,
  creditLots,
  packageLedger,
  refunds,
  slotDiscounts,
  subscriptionPeriods,
} from '../../db/schema';
import { runSeed } from '../../db/seed';
import { buildRegistry } from '../../extensions';
import { expireHoldingBooking } from '../booking/expire-booking';
import { newAfterCommit } from '../booking/effects';
import { applyProviderStatus, SYSTEM_CONTEXT } from '../payments/payment-effects.service';
import { saveSetting } from '../settings/settings.repo';
import { backfillDeferredCreditGrants } from './ports';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

// Tuesday 2026-10-20 09:00 BRT. Bookings go on the next Tuesday/Wednesday (7+ days ahead).
const NOW = new Date('2026-10-20T12:00:00.000Z');
const TUE = '2026-10-27';
const WED = '2026-10-28';
const env = testEnv();
const deps = () => ({ db, env, fetch: forbiddenFetch, now: () => NOW, registry: buildRegistry() });
const app = () => createApp({ ...deps() });

let roomId = '';
beforeEach(async () => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  await runSeed(db);
  await withTransaction(db, (tx) => saveSetting(tx, 'onboarding.prices_reviewed', true, null));
  roomId = (await seededRoom(db)).id;
});

// Tue 14:00–16:00 = 2 h × R$ 80,00 = R$ 160,00 (W-PR "2 horas ou mais").
const TUE_14_16 = { roomSlug: 'principal', date: TUE, startMinute: 840, endMinute: 960 };
const WED_19_20 = { roomSlug: 'principal', date: WED, startMinute: 1140, endMinute: 1200 };

const quote = async (cookie: string, body: Record<string, unknown>) => {
  const res = await send(app(), 'POST', '/public/bookings/quote', { cookie, body });
  expect(res.status).toBe(200);
  const parsed = quoteSchema.parse(res.body);
  return { quote: parsed, revenue: revenueQuoteSchema.parse(parsed.extensions) };
};

const book = (cookie: string, body: Record<string, unknown>, expectedTotalCents: number) =>
  send(app(), 'POST', '/app/bookings', {
    cookie,
    body: { ...body, acceptPolicy: true, policyVersion: 1, expectedTotalCents },
    headers: { 'Idempotency-Key': randomUUID() },
  });

async function slotDiscount(date: LocalDate, start: number, end: number, percent: number) {
  await db.insert(slotDiscounts).values({
    roomId,
    period: `[${localToUtc(date, start).toISOString()},${localToUtc(date, end).toISOString()})`,
    percent,
  });
}

async function approve(bookingId: string, userId: string, amountCents: number) {
  const charge = await createCharge(db, {
    userId,
    bookingId,
    purpose: 'booking_deposit',
    amountCents,
    status: 'pending',
  });
  await applyProviderStatus(deps(), {
    provider: 'sandbox',
    chargeId: charge.id,
    status: 'approved',
    amountCents,
  });
  return charge;
}

const bookingRow = async (id: string) =>
  (await db.select().from(bookings).where(eq(bookings.id, id)))[0];

describe('discount step (REC-120, REC-122, REC-124, REC-138)', () => {
  it('coupon R$ 20 beats slot 10% on 16000: net 14000, deposit 7000, use reserved then consumed', async () => {
    const coupon = await createCoupon(db, {
      code: 'VINTE',
      discountKind: 'fixed',
      discountValue: 2000,
    });
    await slotDiscount(TUE, 840, 960, 10);
    const { user, cookie } = await createTenant(db, { now: NOW });

    const { quote: q, revenue } = await quote(cookie, { ...TUE_14_16, couponCode: 'vinte' });
    expect(q.netCents).toBe(14_000);
    expect(q.payment.depositCents).toBe(7000);
    expect(revenue.discount).toMatchObject({
      source: 'coupon',
      discountCents: 2000,
      slotDiscountCents: 1600,
      couponDiscountCents: 2000,
      couponId: coupon.id,
    });
    // Intl writes "R$" with a no-break space.
    expect(revenue.discount.note?.replaceAll(' ', ' ')).toBe(
      'Aplicamos o maior desconto: cupom R$ 20,00 (o desconto do horário era R$ 16,00).',
    );

    const res = await book(cookie, { ...TUE_14_16, couponCode: 'VINTE' }, 14_000);
    expect(res.status).toBe(201);
    const id = (res.body as { id: string }).id;
    expect(await bookingRow(id)).toMatchObject({
      status: 'awaiting_payment',
      discountSource: 'coupon',
      discountCents: 2000,
      depositCents: 7000,
      couponId: coupon.id,
    });
    const [reserved] = await db.select().from(couponUses).where(eq(couponUses.bookingId, id));
    expect(reserved).toMatchObject({ status: 'reserved', discountCents: 2000 });
    expect((await db.select().from(coupons).where(eq(coupons.id, coupon.id)))[0]?.usesCount).toBe(
      1,
    );

    await approve(id, user.id, 7000);
    const [consumed] = await db.select().from(couponUses).where(eq(couponUses.bookingId, id));
    expect(consumed?.status).toBe('consumed');
    const parts = await db.select().from(slotDiscounts);
    expect(parts.map((p) => p.consumedByBookingId)).toEqual([id]);
  });

  it('an expired checkout releases the coupon use and its counter', async () => {
    const coupon = await createCoupon(db, {
      code: 'VINTE',
      discountKind: 'fixed',
      discountValue: 2000,
    });
    const { cookie } = await createTenant(db, { now: NOW });
    const res = await book(cookie, { ...TUE_14_16, couponCode: 'VINTE' }, 14_000);
    const row = await bookingRow((res.body as { id: string }).id);
    if (row === undefined) throw new Error('no booking');
    await withTransaction(db, (tx) =>
      expireHoldingBooking(tx, deps(), SYSTEM_CONTEXT, row, newAfterCommit(), NOW),
    );
    const [use] = await db.select().from(couponUses).where(eq(couponUses.bookingId, row.id));
    expect(use?.status).toBe('released');
    expect((await db.select().from(coupons).where(eq(coupons.id, coupon.id)))[0]?.usesCount).toBe(
      0,
    );
  });

  it('a rejected coupon shows its reason in the quote and fails the checkout with COUPON_INVALID', async () => {
    await createCoupon(db, { code: 'OFF', enabled: false });
    const { cookie } = await createTenant(db, { now: NOW });
    const { revenue } = await quote(cookie, { ...TUE_14_16, couponCode: 'OFF' });
    expect(revenue.discount.couponRejection).toEqual({
      reason: 'disabled',
      message: 'Cupom desabilitado',
    });
    const res = await book(cookie, { ...TUE_14_16, couponCode: 'OFF' }, 16_000);
    expect(res.status).toBe(422);
    expect(res.error?.code).toBe('COUPON_INVALID');
    expect(await db.select().from(bookings)).toHaveLength(0);
  });
});

describe('package step (REC-27, REC-29, REC-30)', () => {
  async function subscriber(balance: number) {
    const tenant = await createTenant(db, { now: NOW });
    const { period } = await createSubscription(db, {
      userId: tenant.user.id,
      category: await createHourPackageCategory(db),
      baseOn: '2026-10-20',
      period: { minutesBalance: balance },
    });
    return { ...tenant, period };
  }

  it('payWith package: confirmed with payment_mode package, 78 min debited, total 0, no discount', async () => {
    await slotDiscount(WED, 1140, 1200, 10);
    const { cookie, period } = await subscriber(1200);
    const { quote: q, revenue } = await quote(cookie, { ...WED_19_20, payWith: 'package' });
    expect(revenue.packageOption).toMatchObject({ debitMinutes: 78, sufficient: true });
    expect(revenue.discount.source).toBe('none');
    const res = await book(cookie, { ...WED_19_20, payWith: 'package' }, q.netCents);
    expect(res.status).toBe(201);
    const row = await bookingRow((res.body as { id: string }).id);
    expect(row).toMatchObject({
      status: 'confirmed',
      paymentMode: 'package',
      totalCents: 0,
      discountSource: 'none',
      packageMinutesDebited: 78,
      extraMinutesDebited: 0,
    });
    const [p] = await db
      .select()
      .from(subscriptionPeriods)
      .where(eq(subscriptionPeriods.id, period?.id ?? ''));
    expect(p?.minutesBalance).toBe(1122);
  });

  it('an insufficient balance answers 422 INSUFFICIENT_BALANCE and creates no booking', async () => {
    const { cookie } = await subscriber(40);
    const { quote: q, revenue } = await quote(cookie, { ...WED_19_20, payWith: 'package' });
    expect(revenue.packageOption).toMatchObject({ sufficient: false, reason: 'insufficient' });
    const res = await book(cookie, { ...WED_19_20, payWith: 'package' }, q.netCents);
    expect(res.status).toBe(422);
    expect(res.error?.code).toBe('INSUFFICIENT_BALANCE');
    expect(await db.select().from(bookings)).toHaveLength(0);
  });

  it('a tenant cancel ≥ 24 h returns the minutes through the package mode handler (REC-34)', async () => {
    const { cookie, period } = await subscriber(1200);
    const { quote: q } = await quote(cookie, { ...WED_19_20, payWith: 'package' });
    const id = (
      (await book(cookie, { ...WED_19_20, payWith: 'package' }, q.netCents)).body as { id: string }
    ).id;
    const res = await send(app(), 'POST', `/app/bookings/${id}/cancel`, {
      cookie,
      body: {},
      headers: { 'Idempotency-Key': randomUUID() },
    });
    expect(res.status).toBe(200);
    const [p] = await db
      .select()
      .from(subscriptionPeriods)
      .where(eq(subscriptionPeriods.id, period?.id ?? ''));
    expect(p?.minutesBalance).toBe(1200);
    const entries = await db.select().from(packageLedger).where(eq(packageLedger.bookingId, id));
    expect(entries.map((e) => [e.entryType, e.minutes])).toEqual([
      ['debit', -78],
      ['refund', 78],
    ]);
  });

  it('a package reschedule re-debits the new interval and charges nothing (REC-37)', async () => {
    const { cookie, period } = await subscriber(1200);
    const { quote: q } = await quote(cookie, { ...WED_19_20, payWith: 'package' });
    const id = (
      (await book(cookie, { ...WED_19_20, payWith: 'package' }, q.netCents)).body as { id: string }
    ).id;
    const res = await send(app(), 'POST', `/app/bookings/${id}/reschedule`, {
      cookie,
      body: { date: TUE, startMinute: 600, endMinute: 720 },
      headers: { 'Idempotency-Key': randomUUID() },
    });
    expect(res.status).toBe(200);
    const [p] = await db
      .select()
      .from(subscriptionPeriods)
      .where(eq(subscriptionPeriods.id, period?.id ?? ''));
    expect(p?.minutesBalance).toBe(1080);
    expect(await db.select().from(charges)).toHaveLength(0);
  });
});

describe('credit step (REC-107, REC-109, REC-111)', () => {
  async function bookWithCredit() {
    const tenant = await createTenant(db, { now: NOW });
    const lot = await createCreditLot(db, { userId: tenant.user.id, amountCents: 5000 });
    const { quote: q, revenue } = await quote(tenant.cookie, { ...TUE_14_16, useCredits: true });
    expect(revenue.credit).toEqual({ availableCents: 5000, appliedCents: 5000 });
    expect(q.payment.payNowCents).toBe(3000);
    const res = await book(tenant.cookie, { ...TUE_14_16, useCredits: true }, 16_000);
    expect(res.status).toBe(201);
    const id = (res.body as { id: string }).id;
    return { ...tenant, lot, id };
  }

  it('pays part of the deposit with one internal credit charge', async () => {
    const { lot, id } = await bookWithCredit();
    const [internal] = await db
      .select()
      .from(charges)
      .where(and(eq(charges.bookingId, id), eq(charges.method, 'credit')));
    expect(internal).toMatchObject({
      provider: 'internal',
      status: 'approved',
      amountCents: 5000,
      purpose: 'booking_deposit',
    });
    expect(await bookingRow(id)).toMatchObject({ creditAppliedCents: 5000, paidCents: 5000 });
    expect(
      (await db.select().from(creditLots).where(eq(creditLots.id, lot.id)))[0]?.remainingCents,
    ).toBe(0);
  });

  it('a tenant cancel ≥ 24 h with a refundable deposit returns the credit share to the lot', async () => {
    await withTransaction(db, (tx) => saveSetting(tx, 'payment.deposit_refundable', true, null));
    const { user, cookie, lot, id } = await bookWithCredit();
    const cash = await approve(id, user.id, 3000);
    const res = await send(app(), 'POST', `/app/bookings/${id}/cancel`, {
      cookie,
      body: {},
      headers: { 'Idempotency-Key': randomUUID() },
    });
    expect(res.status).toBe(200);
    expect(
      (await db.select().from(creditLots).where(eq(creditLots.id, lot.id)))[0]?.remainingCents,
    ).toBe(5000);
    const cashRefunds = await db.select().from(refunds);
    expect(cashRefunds.map((r) => [r.chargeId, r.amountCents])).toEqual([[cash.id, 3000]]);
  });

  it('a clinic cancel resolved as credit grants the paid amount as a clinic_cancellation lot', async () => {
    const { user, id } = await bookWithCredit();
    await approve(id, user.id, 3000);
    const admin = await createStaff(db, 'admin', NOW);
    const res = await send(app(), 'POST', `/admin/bookings/${id}/cancel`, {
      cookie: admin.cookie,
      body: { reason: 'Manutenção da sala', resolution: 'credit' },
    });
    expect(res.status).toBe(200);
    const granted = await db
      .select()
      .from(creditLots)
      .where(and(eq(creditLots.userId, user.id), eq(creditLots.source, 'clinic_cancellation')));
    expect(granted.map((l) => l.amountCents)).toEqual([8000]);
    expect(await db.select().from(refunds)).toHaveLength(0);
  });
});

describe('payment-mode handlers and credit port (REC-94, REC-95, REC-110)', () => {
  it('a cheaper reschedule grants the difference as a reschedule_difference lot', async () => {
    const { user, cookie } = await createTenant(db, { now: NOW });
    const booking = await insertBooking(db, {
      userId: user.id,
      roomId,
      startsAt: localToUtc(TUE, 840),
      endsAt: localToUtc(TUE, 960),
      status: 'paid',
      totalCents: 16_000,
      paidCents: 16_000,
      depositCents: 8000,
    });
    const res = await send(app(), 'POST', `/app/bookings/${booking.id}/reschedule`, {
      cookie,
      body: { date: TUE, startMinute: 600, endMinute: 660 },
      headers: { 'Idempotency-Key': randomUUID() },
    });
    expect(res.status).toBe(200);
    expect((res.body as { creditCents: number }).creditCents).toBe(6300);
    const lots = await db.select().from(creditLots).where(eq(creditLots.userId, user.id));
    expect(lots.map((l) => [l.source, l.amountCents])).toEqual([['reschedule_difference', 6300]]);
  });

  it('cancelling and rescheduling a fixed occurrence moves no money', async () => {
    const { user, cookie } = await createTenant(db, { now: NOW });
    const occurrence = (start: number) =>
      insertBooking(db, {
        userId: user.id,
        roomId,
        kind: 'fixed_occurrence',
        paymentMode: 'subscription',
        startsAt: localToUtc(TUE, start),
        endsAt: localToUtc(TUE, start + 150),
        totalCents: 0,
        paidCents: 0,
        depositCents: 0,
      });
    const first = await occurrence(420);
    const second = await occurrence(780);
    const cancel = await send(app(), 'POST', `/app/bookings/${first.id}/cancel`, {
      cookie,
      body: {},
      headers: { 'Idempotency-Key': randomUUID() },
    });
    expect(cancel.status).toBe(200);
    const moved = await send(app(), 'POST', `/app/bookings/${second.id}/reschedule`, {
      cookie,
      body: { date: WED, startMinute: 780, endMinute: 930 },
      headers: { 'Idempotency-Key': randomUUID() },
    });
    expect(moved.status).toBe(200);
    expect((moved.body as { creditCents: number }).creditCents).toBe(0);
    expect(await db.select().from(charges)).toHaveLength(0);
    expect(await db.select().from(refunds)).toHaveLength(0);
    expect(await db.select().from(creditLots)).toHaveLength(0);
  });

  it('backfills a deferred grant into one credit lot; a second run creates nothing', async () => {
    const { user } = await createTenant(db, { now: NOW });
    const booking = await insertBooking(db, {
      userId: user.id,
      roomId,
      startsAt: localToUtc(TUE, 600),
      endsAt: localToUtc(TUE, 660),
    });
    await db.insert(bookingEvents).values({
      bookingId: booking.id,
      fromStatus: 'confirmed',
      toStatus: 'confirmed',
      origin: 'app',
      reason: 'rescheduled',
      data: { creditGrant: { amountCents: 6300, status: 'deferred' } },
    });
    expect(await backfillDeferredCreditGrants(db, NOW)).toBe(1);
    expect(await backfillDeferredCreditGrants(db, NOW)).toBe(0);
    const lots = await db.select().from(creditLots).where(eq(creditLots.userId, user.id));
    expect(lots.map((l) => [l.source, l.amountCents, l.remainingCents])).toEqual([
      ['reschedule_difference', 6300, 6300],
    ]);
  });
});

describe('availability decorator (REC-136)', () => {
  it('marks available cells inside an active discount with discountPercent', async () => {
    await slotDiscount(TUE, 840, 960, 10);
    const res = await send(app(), 'GET', `/public/rooms/principal/availability?date=${TUE}`);
    const day = availabilityDaySchema.parse(res.body);
    const percent = (minute: number) =>
      day.cells.find((c) => c.startMinute === minute)?.discountPercent;
    expect([percent(840), percent(930)]).toEqual([10, 10]);
    expect([percent(810), percent(960)]).toEqual([undefined, undefined]);
  });
});
