import { calendarEventsSchema, localToUtc, priceHourlyBooking, type LocalDate } from '@bravo/core';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createStaff, createTenant, seededRoom } from '../../../test/booking-helpers';
import { createBooking } from '../../../test/factories';
import {
  createExtraLot,
  createHourPackageCategory,
  createSubscription,
} from '../../../test/factories/revenue';
import { forbiddenFetch, send, testEnv } from '../../../test/http';
import { requireTestDatabaseUrl } from '../../../test/require-test-db';
import { createApp } from '../../app';
import { createDb, withTransaction } from '../../db/client';
import {
  bookings,
  extraMinuteLots,
  extraMinutesLedger,
  packageLedger,
  subscriptionPeriods,
  subscriptions,
} from '../../db/schema';
import { runSeed } from '../../db/seed';
import type { RequestContext } from '../../lib/audit';
import { AppError } from '../../lib/errors';
import { loadHourlyCategories } from '../calendar/calendar.repo';
import {
  debitForBooking,
  quotePackageOption,
  redebitForReschedule,
  returnForCancellation,
  type PackageDraft,
} from './package-payment.service';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

// Monday 2026-11-02 09:00 BRT; the active period is [2026-11-02, 2026-12-02).
const NOW = new Date('2026-11-02T12:00:00.000Z');
const WED = '2026-11-04';
const TUE = '2026-11-03';
const ctx: RequestContext = {
  actorUserId: null,
  actorRole: null,
  origin: 'app',
  ip: null,
  requestId: null,
};

let roomId = '';
beforeEach(async () => {
  await runSeed(db);
  roomId = (await seededRoom(db)).id;
});

/** The nucleo pricing of an hourly interval with the seeded categories (V_slot per segment). */
async function draftFor(
  date: LocalDate,
  startMinute: number,
  endMinute: number,
): Promise<PackageDraft> {
  const categories = await loadHourlyCategories(db);
  const priced = priceHourlyBooking({ date, startMinute, endMinute, isHoliday: false, categories });
  if (!priced.ok) throw new Error('uncovered interval');
  return { date, startsAt: localToUtc(date, startMinute), segments: priced.segments };
}

async function subscriber(opts: { balance?: number; status?: string } = {}) {
  const { user, cookie } = await createTenant(db);
  const category = await createHourPackageCategory(db);
  const { subscription, period } = await createSubscription(db, {
    userId: user.id,
    category,
    status: opts.status ?? 'active',
    period: { minutesBalance: opts.balance ?? 1200 },
  });
  if (period === null) throw new Error('no period');
  return { user, cookie, category, subscription, period };
}

async function bookingAt(userId: string, date: LocalDate, start: number, end: number) {
  return createBooking(db, {
    userId,
    roomId,
    startsAt: localToUtc(date, start),
    endsAt: localToUtc(date, end),
    paymentMode: 'package',
    totalCents: 0,
    paidCents: 0,
    depositCents: 0,
  });
}

async function debit(userId: string, bookingId: string, draft: PackageDraft) {
  return withTransaction(db, (tx) =>
    debitForBooking(tx, ctx, { bookingId, userId, draft, now: NOW }),
  );
}

async function balanceOf(periodId: string) {
  const [row] = await db
    .select()
    .from(subscriptionPeriods)
    .where(eq(subscriptionPeriods.id, periodId));
  return row?.minutesBalance;
}

async function errorOf(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('expected an AppError');
}

describe('quotePackageOption (REC-23, REC-25, REC-26, REC-33)', () => {
  it('Wed 19:00–20:00 debits 78 min with the formula text and the exact extra', async () => {
    const { user } = await subscriber();
    const { option } = await quotePackageOption(db, user.id, await draftFor(WED, 1140, 1200), NOW);
    expect(option).toMatchObject({
      debitMinutes: 78,
      fromPackageMinutes: 78,
      fromExtraMinutes: 0,
      packageAvailableMinutes: 1200,
      extraAvailableMinutes: 0,
      sufficient: true,
      detailText: '60 min + 18 min de excedente = 78 min',
    });
    expect(option?.reason).toBeUndefined();
    expect(option?.breakdown).toEqual([
      {
        startMinute: 1140,
        endMinute: 1200,
        minutes: 60,
        vSlotCentsPerHour: 12000,
        extraExact: '69/4',
      },
    ]);
  });

  it('Tue 17:30–20:00 debits 152 min', async () => {
    const { user } = await subscriber();
    const { option } = await quotePackageOption(db, user.id, await draftFor(TUE, 1050, 1200), NOW);
    expect(option?.debitMinutes).toBe(152);
  });

  it('takes package minutes first and then extra lots', async () => {
    const { user } = await subscriber({ balance: 40 });
    await createExtraLot(db, { userId: user.id, minutes: 300 });
    const { option } = await quotePackageOption(db, user.id, await draftFor(WED, 1140, 1200), NOW);
    expect(option).toMatchObject({
      debitMinutes: 78,
      fromPackageMinutes: 40,
      fromExtraMinutes: 38,
      sufficient: true,
    });
  });

  it('beyond the active period uses lots only, and reports outside_period when none cover it', async () => {
    const { user } = await subscriber();
    const later = await draftFor('2026-12-09', 1140, 1200);
    const none = await quotePackageOption(db, user.id, later, NOW);
    expect(none.option).toMatchObject({
      sufficient: false,
      reason: 'outside_period',
      packageAvailableMinutes: 0,
    });
    await createExtraLot(db, { userId: user.id, minutes: 300 });
    const lots = await quotePackageOption(db, user.id, later, NOW);
    expect(lots.option).toMatchObject({
      sufficient: true,
      fromPackageMinutes: 0,
      fromExtraMinutes: 78,
    });
  });

  it('a suspended subscription offers no package minutes but its lots stay usable (REC-55)', async () => {
    const { user } = await subscriber({ status: 'suspended' });
    const draft = await draftFor(WED, 1140, 1200);
    const blocked = await quotePackageOption(db, user.id, draft, NOW);
    expect(blocked.option).toMatchObject({
      sufficient: false,
      reason: 'suspended',
      packageAvailableMinutes: 0,
    });
    await createExtraLot(db, { userId: user.id, minutes: 300 });
    const withLots = await quotePackageOption(db, user.id, draft, NOW);
    expect(withLots.option).toMatchObject({ sufficient: true, fromExtraMinutes: 78 });
  });

  it('a block-priced interval gets a null option with block_category and cannot be debited (REC-31)', async () => {
    const { user } = await subscriber();
    const draft: PackageDraft = {
      date: TUE,
      startsAt: localToUtc(TUE, 420),
      segments: [{ startMinute: 420, endMinute: 720, minutes: 300, rateCentsPerHour: null }],
    };
    const quote = await quotePackageOption(db, user.id, draft, NOW);
    expect(quote.option).toBeNull();
    expect(quote.blocked).toBe('block_category');
    const booking = await bookingAt(user.id, TUE, 420, 720);
    const error = await errorOf(debit(user.id, booking.id, draft));
    expect(error).toMatchObject({ status: 422, code: 'POLICY_VIOLATION' });
  });

  it('offers nothing to a user without hour package and without lots', async () => {
    const { user } = await createTenant(db);
    const quote = await quotePackageOption(db, user.id, await draftFor(WED, 1140, 1200), NOW);
    expect(quote.option).toBeNull();
    expect(quote.blocked).toBeUndefined();
  });
});

describe('debitForBooking (REC-27, REC-29, REC-32)', () => {
  it('writes the debit with V_ref 9700 and V_pac 8000 in its detail and fills the booking columns', async () => {
    const { user, period, subscription } = await subscriber();
    const booking = await bookingAt(user.id, WED, 1140, 1200);
    const result = await debit(user.id, booking.id, await draftFor(WED, 1140, 1200));
    expect(result).toMatchObject({ packageMinutes: 78, extraMinutes: 0 });
    const [entry] = await db
      .select()
      .from(packageLedger)
      .where(eq(packageLedger.bookingId, booking.id));
    expect(entry).toMatchObject({ entryType: 'debit', minutes: -78, periodId: period.id });
    expect(entry?.detail).toMatchObject({
      vRefCentsPerHour: 9700,
      vPacCentsPerHour: 8000,
      durationMinutes: 60,
      debitMinutes: 78,
      extraExact: { num: '69', den: '4' },
      segments: [expect.objectContaining({ vSlotCentsPerHour: 12000, minutes: 60 })],
    });
    const [row] = await db.select().from(bookings).where(eq(bookings.id, booking.id));
    expect(row).toMatchObject({
      packageMinutesDebited: 78,
      extraMinutesDebited: 0,
      subscriptionId: subscription.id,
      subscriptionPeriodId: period.id,
    });
    expect(await balanceOf(period.id)).toBe(1122);
  });

  it('answers INSUFFICIENT_BALANCE with required and available minutes and writes nothing', async () => {
    const { user, period } = await subscriber({ balance: 40 });
    const booking = await bookingAt(user.id, WED, 1140, 1200);
    const error = await errorOf(debit(user.id, booking.id, await draftFor(WED, 1140, 1200)));
    expect(error).toMatchObject({ status: 422, code: 'INSUFFICIENT_BALANCE' });
    expect(error.details).toEqual([
      expect.objectContaining({ path: 'requiredMinutes', value: 78 }),
      expect.objectContaining({ path: 'availableMinutes', value: 40 }),
    ]);
    expect(await balanceOf(period.id)).toBe(40);
  });

  it('two parallel package bookings over the balance: exactly one succeeds', async () => {
    const { user, period } = await subscriber({ balance: 100 });
    const a = await bookingAt(user.id, WED, 1140, 1200);
    const b = await bookingAt(user.id, '2026-11-05', 1140, 1200);
    const results = await Promise.allSettled([
      debit(user.id, a.id, await draftFor(WED, 1140, 1200)),
      debit(user.id, b.id, await draftFor('2026-11-05', 1140, 1200)),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: 'INSUFFICIENT_BALANCE' });
    expect(await balanceOf(period.id)).toBe(22);
  });
});

describe('returnForCancellation (REC-34..REC-36, REC-38)', () => {
  async function debitedWithLot() {
    const s = await subscriber({ balance: 40 });
    const lot = await createExtraLot(db, { userId: s.user.id, minutes: 300 });
    const booking = await bookingAt(s.user.id, WED, 1140, 1200);
    await debit(s.user.id, booking.id, await draftFor(WED, 1140, 1200));
    return { ...s, lot, booking };
  }
  const lotRemaining = async (id: string) =>
    (await db.select().from(extraMinuteLots).where(eq(extraMinuteLots.id, id)))[0]
      ?.minutesRemaining;

  it('tenant ≥ 24h: package minutes back to the active period and extra minutes to their lot', async () => {
    const { period, lot, booking } = await debitedWithLot();
    const result = await withTransaction(db, (tx) =>
      returnForCancellation(tx, ctx, booking.id, {
        withinDeadline: true,
        actor: 'tenant',
        now: NOW,
      }),
    );
    expect(result.minutesReturned).toBe(78);
    expect(await balanceOf(period.id)).toBe(40);
    expect(await lotRemaining(lot.id)).toBe(300);
    const refunds = await db
      .select()
      .from(packageLedger)
      .where(and(eq(packageLedger.bookingId, booking.id), eq(packageLedger.entryType, 'refund')));
    expect(refunds.map((r) => r.minutes)).toEqual([40]);
  });

  it('tenant < 24h returns nothing', async () => {
    const { period, lot, booking } = await debitedWithLot();
    const result = await withTransaction(db, (tx) =>
      returnForCancellation(tx, ctx, booking.id, {
        withinDeadline: false,
        actor: 'tenant',
        now: NOW,
      }),
    );
    expect(result.minutesReturned).toBe(0);
    expect(await balanceOf(period.id)).toBe(0);
    expect(await lotRemaining(lot.id)).toBe(262);
  });

  it('clinic cancel with the period closed returns the package minutes as a manual 90-day lot', async () => {
    const { user, period, lot, booking } = await debitedWithLot();
    await db
      .update(subscriptionPeriods)
      .set({ status: 'closed' })
      .where(eq(subscriptionPeriods.id, period.id));
    const result = await withTransaction(db, (tx) =>
      returnForCancellation(tx, ctx, booking.id, {
        withinDeadline: false,
        actor: 'clinic',
        now: NOW,
      }),
    );
    expect(result.minutesReturned).toBe(78);
    expect(await lotRemaining(lot.id)).toBe(300);
    const manual = await db
      .select()
      .from(extraMinuteLots)
      .where(and(eq(extraMinuteLots.userId, user.id), eq(extraMinuteLots.source, 'manual')));
    expect(manual).toHaveLength(1);
    expect(manual[0]).toMatchObject({
      minutesGranted: 40,
      expiresAt: new Date(NOW.getTime() + 90 * 86_400_000),
    });
    const [grant] = await db
      .select()
      .from(extraMinutesLedger)
      .where(eq(extraMinutesLedger.lotId, manual[0]?.id ?? ''));
    expect(grant?.detail).toEqual({ reason: 'clinic_cancellation' });
  });

  it('a period closed by a switch returns converted minutes to the successor period', async () => {
    const { user, period, subscription, booking } = await debitedWithLot();
    const bigger = await createHourPackageCategory(db, {
      fixedPriceCents: 225_000,
      includedMinutes: 1800,
    });
    await db
      .update(subscriptions)
      .set({ status: 'switched' })
      .where(eq(subscriptions.id, subscription.id));
    const next = await createSubscription(db, {
      userId: user.id,
      category: bigger,
      period: { minutesBalance: 1800 },
    });
    await db
      .update(subscriptions)
      .set({ switchedToSubscriptionId: next.subscription.id })
      .where(eq(subscriptions.id, subscription.id));
    await db
      .update(subscriptionPeriods)
      .set({ status: 'closed' })
      .where(eq(subscriptionPeriods.id, period.id));
    await withTransaction(db, (tx) =>
      returnForCancellation(tx, ctx, booking.id, {
        withinDeadline: true,
        actor: 'tenant',
        now: NOW,
      }),
    );
    // 40 min of 160000/1200 → 225000/1800: 40 × 160000 × 1800 / (1200 × 225000) = 42.67 → 43.
    expect(await balanceOf(next.period?.id ?? '')).toBe(1843);
    expect(await balanceOf(period.id)).toBe(0);
  });
});

describe('redebitForReschedule (REC-37)', () => {
  it('reverses the old debit and debits the new interval', async () => {
    const { user, period } = await subscriber();
    const booking = await bookingAt(user.id, WED, 1140, 1200);
    await debit(user.id, booking.id, await draftFor(WED, 1140, 1200));
    const draft = await draftFor(TUE, 600, 720);
    const result = await withTransaction(db, (tx) =>
      redebitForReschedule(tx, ctx, { bookingId: booking.id, userId: user.id, draft, now: NOW }),
    );
    expect(result.packageMinutes).toBe(120);
    expect(await balanceOf(period.id)).toBe(1080);
    const [row] = await db.select().from(bookings).where(eq(bookings.id, booking.id));
    expect(row?.packageMinutesDebited).toBe(120);
  });

  it('an uncovered new debit fails with INSUFFICIENT_BALANCE and leaves the ledger unchanged', async () => {
    const { user, period } = await subscriber({ balance: 100 });
    const booking = await bookingAt(user.id, WED, 1140, 1200);
    await debit(user.id, booking.id, await draftFor(WED, 1140, 1200));
    const before = await db
      .select()
      .from(packageLedger)
      .where(eq(packageLedger.periodId, period.id));
    const newDraft = await draftFor(TUE, 1050, 1200);
    const error = await errorOf(
      withTransaction(db, (tx) =>
        redebitForReschedule(tx, ctx, {
          bookingId: booking.id,
          userId: user.id,
          draft: newDraft,
          now: NOW,
        }),
      ),
    );
    expect(error.code).toBe('INSUFFICIENT_BALANCE');
    const after = await db
      .select()
      .from(packageLedger)
      .where(eq(packageLedger.periodId, period.id));
    expect(after).toEqual(before);
    expect(await balanceOf(period.id)).toBe(22);
  });
});

describe('GET /admin/calendar/events packageMinutes', () => {
  it('returns packageMinutes 78 for the Wed package booking', async () => {
    const { user } = await subscriber();
    const booking = await bookingAt(user.id, WED, 1140, 1200);
    await debit(user.id, booking.id, await draftFor(WED, 1140, 1200));
    const admin = await createStaff(db, 'admin', NOW);
    const app = createApp({ db, now: () => NOW, fetch: forbiddenFetch, env: testEnv() });
    const res = await send(app, 'GET', `/admin/calendar/events?from=${TUE}&to=${WED}`, {
      cookie: admin.cookie,
    });
    expect(res.status).toBe(200);
    const feed = calendarEventsSchema.parse(res.body);
    expect(feed.bookings.find((b) => b.id === booking.id)?.packageMinutes).toBe(78);
  });
});
