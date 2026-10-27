import { randomUUID } from 'node:crypto';
import { chargeDueAt, periodBounds, type LocalDate } from '@bravo/core';
import type { Db } from '../../src/db/client';
import {
  bookingCategories,
  couponUses,
  coupons,
  creditLedger,
  creditLots,
  extraMinuteLots,
  extraMinutesLedger,
  packageLedger,
  subscriptionPeriods,
  subscriptions,
} from '../../src/db/schema';

type CategoryRow = typeof bookingCategories.$inferSelect;
type CategoryInsert = Partial<typeof bookingCategories.$inferInsert>;

const PERIOD_DAYS = { monthly: 30, bimonthly: 60, quarterly: 90 } as const;
type PackagePeriodName = keyof typeof PERIOD_DAYS;

async function insertCategory(db: Db, values: typeof bookingCategories.$inferInsert) {
  const [row] = await db.insert(bookingCategories).values(values).returning();
  if (row === undefined) throw new Error('category insert returned no row');
  return row;
}

/** "Pacote 20h mensal": R$ 1.600,00 for 1200 min (V_pac 8000), unless overridden. */
export function createHourPackageCategory(db: Db, overrides: CategoryInsert = {}) {
  return insertCategory(db, {
    name: `Pacote 20h mensal ${randomUUID().slice(0, 6)}`,
    type: 'hour_package',
    fixedPriceCents: 160_000,
    includedMinutes: 1200,
    period: 'monthly',
    ...overrides,
  });
}

/** "Meio turno mensal": Mon–Fri 07:00–09:30 at R$ 280,00 per occurrence, unless overridden. */
export function createFixedCategory(db: Db, overrides: CategoryInsert = {}) {
  return insertCategory(db, {
    name: `Meio turno mensal ${randomUUID().slice(0, 6)}`,
    type: 'fixed_schedule',
    weekdays: [1, 2, 3, 4, 5],
    startMinute: 420,
    endMinute: 570,
    pricePerOccurrenceCents: 28_000,
    period: 'monthly',
    ...overrides,
  });
}

/** The `price_snapshot` a subscription period stores for `category`. */
export function snapshotOf(category: CategoryRow) {
  return category.type === 'hour_package'
    ? {
        categoryVersion: category.version,
        priceCents: category.fixedPriceCents,
        includedMinutes: category.includedMinutes,
      }
    : {
        categoryVersion: category.version,
        pricePerOccurrenceCents: category.pricePerOccurrenceCents,
        weekdays: category.weekdays,
        startMinute: category.startMinute,
        endMinute: category.endMinute,
      };
}

export interface CreateSubscriptionOptions {
  userId: string;
  category: CategoryRow;
  status?: string;
  roomId?: string | null;
  baseOn?: LocalDate;
  paymentMethod?: 'saved_card' | 'pix';
  holdExpiresAt?: Date | null;
  /** First period; `null` creates none. Defaults: seq 1 `active` from `baseOn`. */
  period?: {
    seq?: number;
    startsOn?: LocalDate;
    status?: string;
    priceCents?: number;
    occurrenceCount?: number | null;
    /** Hour package: balance of the period, written as one `period_grant` entry when > 0. */
    minutesBalance?: number;
  } | null;
}

/**
 * Inserts a subscription and (by default) its first period. For an hour package with a balance the
 * period gets one `period_grant` ledger entry, so `minutes_balance` equals the ledger sum.
 */
export async function createSubscription(db: Db, options: CreateSubscriptionOptions) {
  const { category } = options;
  const type = category.type as 'hour_package' | 'fixed_schedule';
  const periodDays = PERIOD_DAYS[category.period as PackagePeriodName];
  const baseOn = options.baseOn ?? '2026-11-02';
  const snapshot = snapshotOf(category);
  const [subscription] = await db
    .insert(subscriptions)
    .values({
      userId: options.userId,
      categoryId: category.id,
      type,
      roomId: options.roomId ?? null,
      status: options.status ?? 'active',
      baseOn,
      periodDays,
      priceSnapshot: snapshot,
      paymentMethod: options.paymentMethod ?? 'pix',
      holdExpiresAt: options.holdExpiresAt ?? null,
      source: 'web',
    })
    .returning();
  if (subscription === undefined) throw new Error('subscription insert returned no row');
  if (options.period === null) return { subscription, period: null };

  const p = options.period ?? {};
  const startsOn = p.startsOn ?? baseOn;
  const { endsOn } = periodBounds(startsOn, periodDays);
  const isHour = type === 'hour_package';
  const balance = isHour ? (p.minutesBalance ?? category.includedMinutes ?? 0) : null;
  const [period] = await db
    .insert(subscriptionPeriods)
    .values({
      subscriptionId: subscription.id,
      seq: p.seq ?? 1,
      startsOn,
      endsOn,
      priceCents:
        p.priceCents ??
        (isHour ? (category.fixedPriceCents ?? 0) : (category.pricePerOccurrenceCents ?? 0) * 22),
      occurrenceCount: isHour ? null : (p.occurrenceCount ?? 22),
      includedMinutes: isHour ? category.includedMinutes : null,
      minutesBalance: balance,
      priceSnapshot: snapshot,
      status: p.status ?? 'active',
      chargeDueAt: chargeDueAt(startsOn, 2),
    })
    .returning();
  if (period === undefined) throw new Error('period insert returned no row');
  if (balance !== null && balance > 0) {
    await db.insert(packageLedger).values({
      subscriptionId: subscription.id,
      periodId: period.id,
      userId: options.userId,
      entryType: 'period_grant',
      minutes: balance,
    });
  }
  return { subscription, period };
}

/** An extra-minute lot with its `grant` entry (default: 300 min, source purchase, 90 days). */
export async function createExtraLot(
  db: Db,
  input: { userId: string; minutes?: number; expiresAt?: Date; source?: string; createdAt?: Date },
) {
  const minutes = input.minutes ?? 300;
  const [lot] = await db
    .insert(extraMinuteLots)
    .values({
      userId: input.userId,
      source: input.source ?? 'purchase',
      minutesGranted: minutes,
      minutesRemaining: minutes,
      expiresAt: input.expiresAt ?? new Date('2027-02-08T03:00:00Z'),
      ...(input.createdAt !== undefined && { createdAt: input.createdAt }),
    })
    .returning();
  if (lot === undefined) throw new Error('extra lot insert returned no row');
  await db.insert(extraMinutesLedger).values({
    lotId: lot.id,
    userId: input.userId,
    entryType: 'grant',
    minutes,
  });
  return lot;
}

/** A credit lot with its `grant` entry (default: R$ 50,00, source manual, 90 days). */
export async function createCreditLot(
  db: Db,
  input: {
    userId: string;
    amountCents?: number;
    expiresAt?: Date;
    source?: string;
    createdAt?: Date;
  },
) {
  const amount = input.amountCents ?? 5000;
  const [lot] = await db
    .insert(creditLots)
    .values({
      userId: input.userId,
      source: input.source ?? 'manual',
      amountCents: amount,
      remainingCents: amount,
      expiresAt: input.expiresAt ?? new Date('2027-02-08T03:00:00Z'),
      ...(input.createdAt !== undefined && { createdAt: input.createdAt }),
    })
    .returning();
  if (lot === undefined) throw new Error('credit lot insert returned no row');
  await db.insert(creditLedger).values({
    lotId: lot.id,
    userId: input.userId,
    entryType: 'grant',
    amountCents: amount,
  });
  return lot;
}

/** A coupon (default: "BRAVO10", 10% discount on both, unlimited). */
export async function createCoupon(db: Db, overrides: Partial<typeof coupons.$inferInsert> = {}) {
  const [coupon] = await db
    .insert(coupons)
    .values({
      code: `BRAVO${randomUUID().slice(0, 6).toUpperCase()}`,
      type: 'discount',
      discountKind: 'percent',
      discountValue: 1000,
      appliesTo: 'both',
      ...overrides,
    })
    .returning();
  if (coupon === undefined) throw new Error('coupon insert returned no row');
  return coupon;
}

/** A coupon use row (default `reserved`). Does not touch `coupons.uses_count`. */
export async function createCouponUse(
  db: Db,
  input: {
    couponId: string;
    userId: string;
    status?: string;
    docNumber?: string | null;
    bookingId?: string | null;
    subscriptionId?: string | null;
    discountCents?: number;
  },
) {
  const [use] = await db
    .insert(couponUses)
    .values({
      couponId: input.couponId,
      userId: input.userId,
      status: input.status ?? 'reserved',
      docNumber: input.docNumber ?? null,
      bookingId: input.bookingId ?? null,
      subscriptionId: input.subscriptionId ?? null,
      discountCents: input.discountCents ?? 0,
    })
    .returning();
  if (use === undefined) throw new Error('coupon use insert returned no row');
  return use;
}
