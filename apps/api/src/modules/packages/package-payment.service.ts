import {
  allocateMinutes,
  convertPackageBalance,
  formatDebitDetail,
  isDateInPeriod,
  packageDebitMinutes,
  vPacCents,
  type LocalDate,
  type PackageOption,
  type PackageRate,
  type QuoteSegment,
} from '@bravo/core';
import { and, asc, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import type { Db, Tx } from '../../db/client';
import {
  bookings,
  extraMinuteLots,
  extraMinutesLedger,
  packageLedger,
  subscriptionPeriods,
  subscriptions,
} from '../../db/schema';
import type { RequestContext } from '../../lib/audit';
import { AppError } from '../../lib/errors';
import { getReferenceCategory } from '../calendar/calendar.repo';
import { addDaysToInstant } from '../revenue/instants';
import { loadSettings } from '../settings/settings.repo';
import {
  createLot,
  debitLots,
  debitPeriod,
  insufficientBalance,
  lockUsableLots,
  refundLot,
  refundPeriod,
  type ExtraLotRow,
  type PeriodRow,
} from './minutes.service';

// Paying a booking with package hours (PRD §5.3.1, REC-23..REC-38, REC-55, REC-68). The quote
// reads without locks; the debit at creation locks the period and the lots and recomputes, so the
// stored debit always follows the server's values (REC-33).

type SubscriptionRow = typeof subscriptions.$inferSelect;

/** What a package option needs from the booking being priced. */
export interface PackageDraft {
  date: LocalDate;
  startsAt: Date;
  segments: Pick<QuoteSegment, 'startMinute' | 'endMinute' | 'minutes' | 'rateCentsPerHour'>[];
}

export interface PackageQuote {
  /** null: nothing to offer (no hour package and no usable lot, or a block-priced interval). */
  option: PackageOption | null;
  /** Set when the option is null because the interval is priced by a block (REC-31). */
  blocked?: 'block_category';
  /** The package rate and the period the debit would use (debit detail and booking columns). */
  rate: PackageRate | null;
  subscription: SubscriptionRow | null;
  period: PeriodRow | null;
  lots: ExtraLotRow[];
  allocation: ReturnType<typeof allocateMinutes> | null;
  detail: DebitDetail | null;
}

export interface DebitDetail {
  segments: PackageOption['breakdown'];
  vRefCentsPerHour: number;
  vPacCentsPerHour: number;
  priceCents: number;
  includedMinutes: number;
  durationMinutes: number;
  debitMinutes: number;
  extraExact: { num: string; den: string };
}

const rateOf = (snapshot: unknown): PackageRate | null => {
  const s = snapshot as { priceCents?: unknown; includedMinutes?: unknown } | null;
  return typeof s?.priceCents === 'number' && typeof s.includedMinutes === 'number'
    ? { priceCents: s.priceCents, includedMinutes: s.includedMinutes }
    : null;
};

/** The user's live hour package (`active` or `suspended`) and its `active` period, if any. */
async function liveHourPackage(db: Db | Tx, userId: string, lock: boolean) {
  const [subscription] = await db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.userId, userId),
        eq(subscriptions.type, 'hour_package'),
        inArray(subscriptions.status, ['active', 'suspended']),
      ),
    );
  if (subscription === undefined) return { subscription: null, period: null };
  const query = db
    .select()
    .from(subscriptionPeriods)
    .where(
      and(
        eq(subscriptionPeriods.subscriptionId, subscription.id),
        eq(subscriptionPeriods.status, 'active'),
      ),
    );
  const [period] = lock ? await query.for('update') : await query;
  return { subscription, period: period ?? null };
}

/** V_pac terms when only lots pay: the most recent hour-package period of the user. */
async function latestRate(db: Db | Tx, userId: string): Promise<PackageRate | null> {
  const [row] = await db
    .select({ snapshot: subscriptionPeriods.priceSnapshot })
    .from(subscriptionPeriods)
    .innerJoin(subscriptions, eq(subscriptions.id, subscriptionPeriods.subscriptionId))
    .where(and(eq(subscriptions.userId, userId), eq(subscriptions.type, 'hour_package')))
    .orderBy(desc(subscriptionPeriods.startsOn), desc(subscriptionPeriods.seq))
    .limit(1);
  return row === undefined ? null : rateOf(row.snapshot);
}

function fraction(num: bigint, den: bigint): string {
  return num === 0n ? '0' : den === 1n ? num.toString() : `${num.toString()}/${den.toString()}`;
}

async function compute(
  db: Db | Tx,
  userId: string,
  draft: PackageDraft,
  now: Date,
  lock: boolean,
): Promise<PackageQuote> {
  const empty = {
    rate: null,
    subscription: null,
    period: null,
    lots: [],
    allocation: null,
    detail: null,
  };
  if (draft.segments.some((s) => s.rateCentsPerHour === null)) {
    return { option: null, blocked: 'block_category', ...empty };
  }
  const { subscription, period } = await liveHourPackage(db, userId, lock);
  const after = new Date(Math.max(now.getTime(), draft.startsAt.getTime()));
  const lots = lock
    ? await lockUsableLots(db as Tx, userId, after)
    : await db
        .select()
        .from(extraMinuteLots)
        .where(
          and(
            eq(extraMinuteLots.userId, userId),
            gt(extraMinuteLots.minutesRemaining, 0),
            gt(extraMinuteLots.expiresAt, after),
          ),
        )
        .orderBy(asc(extraMinuteLots.id));
  if (subscription === null && lots.length === 0) return { option: null, ...empty };

  const rate =
    rateOf(period?.priceSnapshot) ??
    rateOf(subscription?.priceSnapshot) ??
    (await latestRate(db, userId));
  const reference = await getReferenceCategory(db);
  const segments = draft.segments.map((s) => ({
    minutes: s.minutes,
    vSlotCentsPerHour: s.rateCentsPerHour ?? 0,
  }));
  const vRef = reference?.weekdayRateCents ?? Math.max(...segments.map((s) => s.vSlotCentsPerHour));
  const durationMinutes = segments.reduce((sum, s) => sum + s.minutes, 0);
  const debit =
    rate === null
      ? { minutes: durationMinutes, extraMinutesExact: { num: 0n, den: 1n } }
      : packageDebitMinutes({ segments, vRefCentsPerHour: vRef, pkg: rate });
  const breakdown = draft.segments.map((s) => {
    const vSlot = s.rateCentsPerHour ?? 0;
    const part =
      rate === null
        ? { num: 0n, den: 1n }
        : packageDebitMinutes({
            segments: [{ minutes: s.minutes, vSlotCentsPerHour: vSlot }],
            vRefCentsPerHour: vRef,
            pkg: rate,
          }).extraMinutesExact;
    return {
      startMinute: s.startMinute,
      endMinute: s.endMinute,
      minutes: s.minutes,
      vSlotCentsPerHour: vSlot,
      extraExact: fraction(part.num, part.den),
    };
  });

  const inPeriod =
    subscription?.status === 'active' &&
    period !== null &&
    isDateInPeriod(draft.date, {
      startsOn: period.startsOn as LocalDate,
      endsOn: period.endsOn as LocalDate,
    });
  const packageAvailable = inPeriod ? (period.minutesBalance ?? 0) : 0;
  const allocation = allocateMinutes({
    debit: debit.minutes,
    packageAvailable,
    lots: lots.map((lot) => ({
      id: lot.id,
      remaining: lot.minutesRemaining,
      expiresAt: lot.expiresAt,
      createdAt: lot.createdAt,
    })),
    bookingStartsAt: draft.startsAt,
    now,
    usePackage: inPeriod,
  });
  const fromExtra = allocation.fromLots.reduce((sum, part) => sum + part.minutes, 0);
  let reason: PackageOption['reason'];
  if (!allocation.sufficient) {
    if (subscription?.status === 'suspended') reason = 'suspended';
    else if (!inPeriod) reason = 'outside_period';
    else reason = 'insufficient';
  }
  const option: PackageOption = {
    debitMinutes: debit.minutes,
    fromPackageMinutes: allocation.fromPackage,
    fromExtraMinutes: fromExtra,
    packageAvailableMinutes: packageAvailable,
    extraAvailableMinutes: allocation.available - packageAvailable,
    sufficient: allocation.sufficient,
    ...(reason !== undefined && { reason }),
    breakdown,
    detailText: formatDebitDetail({ durationMinutes, debitMinutes: debit.minutes }),
  };
  const detail: DebitDetail = {
    segments: breakdown,
    vRefCentsPerHour: vRef,
    vPacCentsPerHour: rate === null ? vRef : vPacCents(rate),
    priceCents: rate?.priceCents ?? 0,
    includedMinutes: rate?.includedMinutes ?? 0,
    durationMinutes,
    debitMinutes: debit.minutes,
    extraExact: {
      num: debit.extraMinutesExact.num.toString(),
      den: debit.extraMinutesExact.den.toString(),
    },
  };
  return { option, rate, subscription, period: inPeriod ? period : null, lots, allocation, detail };
}

/** The `packageOption` of a quote (REC-23..REC-27, REC-31, REC-55): a lock-free read. */
export function quotePackageOption(
  db: Db | Tx,
  userId: string,
  draft: PackageDraft,
  now: Date,
): Promise<PackageQuote> {
  return compute(db, userId, draft, now, false);
}

/**
 * Debits a booking paid with the package (REC-29, REC-32): locks the period and the lots,
 * recomputes, writes the `debit` entries with the formula detail and the booking columns.
 * Short balance → 422 `INSUFFICIENT_BALANCE`; a block-priced interval is never debited.
 */
export async function debitForBooking(
  tx: Tx,
  ctx: RequestContext,
  input: { bookingId: string; userId: string; draft: PackageDraft; now: Date },
): Promise<{ packageMinutes: number; extraMinutes: number; detail: DebitDetail }> {
  const quote = await compute(tx, input.userId, input.draft, input.now, true);
  const { option, allocation, detail } = quote;
  if (quote.blocked === 'block_category') {
    throw new AppError(
      422,
      'POLICY_VIOLATION',
      'Reservas de turno não podem ser pagas com pacote de horas.',
    );
  }
  if (option === null || allocation === null || detail === null) {
    const duration = input.draft.segments.reduce((sum, s) => sum + s.minutes, 0);
    throw insufficientBalance(duration, 0);
  }
  if (!allocation.sufficient) throw insufficientBalance(option.debitMinutes, allocation.available);

  const extraMinutes = allocation.fromLots.reduce((sum, part) => sum + part.minutes, 0);
  if (allocation.fromPackage > 0 && quote.period !== null) {
    await debitPeriod(tx, ctx, {
      periodId: quote.period.id,
      minutes: allocation.fromPackage,
      bookingId: input.bookingId,
      detail,
      now: input.now,
    });
  }
  await debitLots(tx, ctx, {
    parts: allocation.fromLots,
    bookingId: input.bookingId,
    detail,
    now: input.now,
  });
  await tx
    .update(bookings)
    .set({
      packageMinutesDebited: allocation.fromPackage,
      extraMinutesDebited: extraMinutes,
      subscriptionId: quote.subscription?.id ?? null,
      subscriptionPeriodId: allocation.fromPackage > 0 ? (quote.period?.id ?? null) : null,
      updatedAt: input.now,
    })
    .where(eq(bookings.id, input.bookingId));
  return { packageMinutes: allocation.fromPackage, extraMinutes, detail };
}

/** Net minutes a booking still holds per period and per lot (debits minus earlier returns). */
async function heldMinutes(tx: Tx, bookingId: string) {
  const periodRows = await tx
    .select({ periodId: packageLedger.periodId, total: sql<string>`sum(${packageLedger.minutes})` })
    .from(packageLedger)
    .where(
      and(
        eq(packageLedger.bookingId, bookingId),
        inArray(packageLedger.entryType, ['debit', 'refund']),
      ),
    )
    .groupBy(packageLedger.periodId);
  const lotRows = await tx
    .select({
      lotId: extraMinutesLedger.lotId,
      total: sql<string>`sum(${extraMinutesLedger.minutes})`,
    })
    .from(extraMinutesLedger)
    .where(
      and(
        eq(extraMinutesLedger.bookingId, bookingId),
        inArray(extraMinutesLedger.entryType, ['debit', 'refund']),
      ),
    )
    .groupBy(extraMinutesLedger.lotId);
  return {
    periods: periodRows
      .map((r) => ({ periodId: r.periodId, minutes: -Number(r.total) }))
      .filter((r) => r.minutes > 0)
      .sort((a, b) => (a.periodId < b.periodId ? -1 : 1)),
    lots: lotRows
      .map((r) => ({ lotId: r.lotId, minutes: -Number(r.total) }))
      .filter((r) => r.minutes > 0)
      .sort((a, b) => (a.lotId < b.lotId ? -1 : 1)),
  };
}

/** The successor's active period of a subscription closed by a switch, with both rates. */
async function switchSuccessor(tx: Tx, periodId: string) {
  const [old] = await tx
    .select({ period: subscriptionPeriods, subscription: subscriptions })
    .from(subscriptionPeriods)
    .innerJoin(subscriptions, eq(subscriptions.id, subscriptionPeriods.subscriptionId))
    .where(eq(subscriptionPeriods.id, periodId));
  const nextId = old?.subscription.switchedToSubscriptionId ?? null;
  if (old === undefined || old.subscription.status !== 'switched' || nextId === null) return null;
  const [next] = await tx
    .select()
    .from(subscriptionPeriods)
    .where(
      and(eq(subscriptionPeriods.subscriptionId, nextId), eq(subscriptionPeriods.status, 'active')),
    );
  const from = rateOf(old.period.priceSnapshot);
  const to = rateOf(next?.priceSnapshot);
  if (next === undefined || from === null || to === null) return null;
  return { period: next, from, to };
}

/**
 * Minutes back when a package booking is cancelled (REC-34..REC-36, REC-38):
 * - tenant within the deadline: package minutes to the debited period while it is `active`, or
 *   converted to the switch successor's active period; extra minutes to unexpired lots;
 * - tenant late (or no-show): nothing;
 * - clinic: everything, to the active period / unexpired lots, the rest to a new `manual` lot.
 */
export async function returnForCancellation(
  tx: Tx,
  ctx: RequestContext,
  bookingId: string,
  opts: { withinDeadline: boolean; actor: 'tenant' | 'clinic'; now: Date },
): Promise<{ minutesReturned: number }> {
  if (opts.actor === 'tenant' && !opts.withinDeadline) return { minutesReturned: 0 };
  const [booking] = await tx.select().from(bookings).where(eq(bookings.id, bookingId));
  if (booking === undefined) return { minutesReturned: 0 };
  const held = await heldMinutes(tx, bookingId);
  let returned = 0;
  let toManualLot = 0;

  for (const part of held.periods) {
    const [period] = await tx
      .select()
      .from(subscriptionPeriods)
      .where(eq(subscriptionPeriods.id, part.periodId))
      .for('update');
    if (period?.status === 'active') {
      await refundPeriod(tx, ctx, {
        periodId: period.id,
        minutes: part.minutes,
        bookingId,
        now: opts.now,
      });
      returned += part.minutes;
      continue;
    }
    const successor = await switchSuccessor(tx, part.periodId);
    if (opts.actor === 'tenant' && successor !== null) {
      const converted = convertPackageBalance({
        remainingMinutes: part.minutes,
        from: successor.from,
        to: successor.to,
      });
      if (converted > 0) {
        await refundPeriod(tx, ctx, {
          periodId: successor.period.id,
          minutes: converted,
          bookingId,
          now: opts.now,
          detail: { fromPeriodId: part.periodId, minutes: part.minutes, converted },
        });
      }
      returned += converted;
    } else if (opts.actor === 'clinic') {
      toManualLot += part.minutes;
    }
  }

  for (const part of held.lots) {
    const [lot] = await tx
      .select()
      .from(extraMinuteLots)
      .where(eq(extraMinuteLots.id, part.lotId))
      .for('update');
    if (lot !== undefined && lot.expiresAt.getTime() > opts.now.getTime()) {
      await refundLot(tx, ctx, { lotId: lot.id, minutes: part.minutes, bookingId, now: opts.now });
      returned += part.minutes;
    } else if (opts.actor === 'clinic') {
      toManualLot += part.minutes;
    }
  }

  if (toManualLot > 0) {
    const settings = await loadSettings(tx);
    await createLot(tx, ctx, {
      userId: booking.userId,
      minutes: toManualLot,
      source: 'manual',
      expiresAt: addDaysToInstant(opts.now, settings['payment.extra_hours_validity_days']),
      bookingId,
      detail: { reason: 'clinic_cancellation' },
      now: opts.now,
    });
    returned += toManualLot;
  }
  return { minutesReturned: returned };
}

/**
 * Reschedule of a package booking (REC-37): reverses what the booking holds and debits the new
 * interval in the caller's transaction. A short new debit throws `INSUFFICIENT_BALANCE`, which
 * rolls the reversal back with it.
 */
export async function redebitForReschedule(
  tx: Tx,
  ctx: RequestContext,
  input: { bookingId: string; userId: string; draft: PackageDraft; now: Date },
): Promise<{ packageMinutes: number; extraMinutes: number; detail: DebitDetail }> {
  const held = await heldMinutes(tx, input.bookingId);
  for (const part of held.periods) {
    await refundPeriod(tx, ctx, {
      periodId: part.periodId,
      minutes: part.minutes,
      bookingId: input.bookingId,
      now: input.now,
      detail: { reason: 'reschedule' },
    });
  }
  for (const part of held.lots) {
    await refundLot(tx, ctx, {
      lotId: part.lotId,
      minutes: part.minutes,
      bookingId: input.bookingId,
      now: input.now,
    });
  }
  return debitForBooking(tx, ctx, input);
}
