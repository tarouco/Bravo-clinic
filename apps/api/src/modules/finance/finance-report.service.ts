import {
  addDays,
  buildDre,
  compare,
  localToUtc,
  previousRange,
  recognize,
  summarize,
  type ChargeFact,
  type DreMatrix,
  type Entry,
  type ExpenseFact,
  type FinanceQuery,
  type LocalDate,
  type ManualReceiptFact,
  type RefundFact,
  type Regime,
  type RevenueCategory,
} from '@bravo/core';
import { and, asc, eq, gte, inArray, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm';
import type { Db, Tx } from '../../db/client';
import {
  bookingExtraItems,
  bookings,
  charges,
  expenseCategories,
  expenses,
  manualReceipts,
  refunds,
  subscriptionPeriods,
} from '../../db/schema';

// Finance facts and reports (AD-027, GES-22..GES-25, GES-29..GES-34): the rows of a range are
// loaded here and the recognition, buckets and DRE are computed by `@bravo/core`, so the screen,
// the spreadsheet and MCP agree to the cent.

/** Charge statuses that carry revenue (refunds and chargebacks reverse it on line 3). */
const REVENUE_STATUSES = ['approved', 'refunded', 'partially_refunded', 'charged_back'] as const;

export interface FinanceFacts {
  charges: ChargeFact[];
  refunds: RefundFact[];
  receipts: ManualReceiptFact[];
  expenses: ExpenseFact[];
}

type Conn = Db | Tx;

/** First approved charge per booking or period, which carries the discount (GES-06). */
async function firstApprovedCharges(
  db: Conn,
  column: typeof charges.bookingId | typeof charges.subscriptionPeriodId,
  ids: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  const rows = await db
    .select({ id: charges.id, owner: column })
    .from(charges)
    .where(
      and(
        inArray(column, ids),
        isNotNull(charges.approvedAt),
        inArray(charges.status, [...REVENUE_STATUSES]),
      ),
    )
    .orderBy(asc(charges.approvedAt), asc(charges.createdAt), asc(charges.id));
  for (const row of rows) {
    if (row.owner !== null && !out.has(row.owner)) out.set(row.owner, row.id);
  }
  return out;
}

/**
 * Every fact that can land in `[from, to]` in either regime: charges approved in the range, of a
 * booking that starts or ends in it, of a period overlapping it, or refunded or charged back in
 * it; the approved refunds of those charges; live manual receipts dated in the range or linked to
 * a booking starting in it; live expenses dated in it. Callers filter entries by date.
 */
export async function loadFacts(
  db: Conn,
  range: { from: LocalDate; to: LocalDate },
): Promise<FinanceFacts> {
  const start = localToUtc(range.from, 0);
  const end = localToUtc(addDays(range.to, 1), 0);
  const inRange = (column: Parameters<typeof gte>[0]) => and(gte(column, start), lt(column, end));

  const bookingIdsInRange = db
    .select({ id: bookings.id })
    .from(bookings)
    .where(or(inRange(bookings.startsAt), inRange(bookings.cancelledAt)));
  const periodIdsInRange = db
    .select({ id: subscriptionPeriods.id })
    .from(subscriptionPeriods)
    .where(
      and(
        lte(subscriptionPeriods.startsOn, range.to),
        sql`${subscriptionPeriods.endsOn} > ${range.from}`,
      ),
    );
  const chargeIdsRefundedInRange = db
    .select({ id: refunds.chargeId })
    .from(refunds)
    .where(and(eq(refunds.status, 'approved'), inRange(refunds.completedAt)));

  const chargeRows = await db
    .select()
    .from(charges)
    .where(
      and(
        isNotNull(charges.approvedAt),
        inArray(charges.status, [...REVENUE_STATUSES]),
        or(
          inRange(charges.approvedAt),
          inArray(charges.bookingId, bookingIdsInRange),
          inArray(charges.subscriptionPeriodId, periodIdsInRange),
          inArray(charges.id, chargeIdsRefundedInRange),
          and(eq(charges.status, 'charged_back'), inRange(charges.updatedAt)),
        ),
      ),
    );

  const bookingIds = [...new Set(chargeRows.flatMap((c) => (c.bookingId ? [c.bookingId] : [])))];
  const periodIds = [
    ...new Set(chargeRows.flatMap((c) => (c.subscriptionPeriodId ? [c.subscriptionPeriodId] : []))),
  ];
  const bookingRows =
    bookingIds.length === 0
      ? []
      : await db
          .select({
            id: bookings.id,
            startsAt: bookings.startsAt,
            status: bookings.status,
            cancelledAt: bookings.cancelledAt,
            paymentMode: bookings.paymentMode,
            totalCents: bookings.totalCents,
            discountCents: bookings.discountCents,
          })
          .from(bookings)
          .where(inArray(bookings.id, bookingIds));
  // Σ booking_extra_items per booking: the extras share of each receipt (GES-08).
  const extrasRows =
    bookingIds.length === 0
      ? []
      : await db
          .select({
            bookingId: bookingExtraItems.bookingId,
            cents: sql<number>`sum(${bookingExtraItems.amountCents})::int`,
          })
          .from(bookingExtraItems)
          .where(inArray(bookingExtraItems.bookingId, bookingIds))
          .groupBy(bookingExtraItems.bookingId);
  const extrasByBooking = new Map(extrasRows.map((r) => [r.bookingId, r.cents]));
  const periodRows =
    periodIds.length === 0
      ? []
      : await db
          .select()
          .from(subscriptionPeriods)
          .where(inArray(subscriptionPeriods.id, periodIds));
  const firstByBooking = await firstApprovedCharges(db, charges.bookingId, bookingIds);
  const firstByPeriod = await firstApprovedCharges(db, charges.subscriptionPeriodId, periodIds);
  const bookingById = new Map(bookingRows.map((b) => [b.id, b]));
  const periodById = new Map(periodRows.map((p) => [p.id, p]));

  const chargeFacts: ChargeFact[] = chargeRows.map((c) => {
    const booking = c.bookingId ? bookingById.get(c.bookingId) : undefined;
    const period = c.subscriptionPeriodId ? periodById.get(c.subscriptionPeriodId) : undefined;
    return {
      id: c.id,
      purpose: c.purpose as ChargeFact['purpose'],
      method: c.method as ChargeFact['method'],
      amountCents: c.amountCents,
      feeCents: c.feeCents,
      status: c.status as ChargeFact['status'],
      approvedAt: c.approvedAt ?? c.createdAt,
      // No dedicated column: a charged-back row was last updated when it became charged back.
      ...(c.status === 'charged_back' && { chargedBackAt: c.updatedAt }),
      ...(booking !== undefined && {
        booking: {
          id: booking.id,
          startsAt: booking.startsAt,
          status: booking.status,
          ...(booking.cancelledAt !== null && { cancelledAt: booking.cancelledAt }),
          paymentMode: booking.paymentMode,
          totalCents: booking.totalCents,
          discountCents: booking.discountCents,
          extrasCents: extrasByBooking.get(booking.id) ?? 0,
          firstApprovedChargeId: firstByBooking.get(booking.id) ?? c.id,
        },
      }),
      ...(period !== undefined && {
        period: {
          id: period.id,
          startsOn: period.startsOn as LocalDate,
          endsOn: period.endsOn as LocalDate,
          discountCents: period.discountCents,
          firstApprovedChargeId: firstByPeriod.get(period.id) ?? c.id,
        },
      }),
    };
  });

  const chargeIds = chargeRows.map((c) => c.id);
  const refundRows =
    chargeIds.length === 0
      ? []
      : await db
          .select()
          .from(refunds)
          .where(
            and(
              inArray(refunds.chargeId, chargeIds),
              eq(refunds.status, 'approved'),
              isNotNull(refunds.completedAt),
            ),
          );

  const receiptRows = await db
    .select({ receipt: manualReceipts, bookingStartsAt: bookings.startsAt })
    .from(manualReceipts)
    .leftJoin(bookings, eq(bookings.id, manualReceipts.bookingId))
    .where(
      and(
        isNull(manualReceipts.deletedAt),
        or(
          and(gte(manualReceipts.date, range.from), lte(manualReceipts.date, range.to)),
          inRange(bookings.startsAt),
        ),
      ),
    );

  const expenseRows = await db
    .select()
    .from(expenses)
    .where(
      and(isNull(expenses.deletedAt), gte(expenses.date, range.from), lte(expenses.date, range.to)),
    );

  return {
    charges: chargeFacts,
    refunds: refundRows.map((r) => ({
      chargeId: r.chargeId,
      amountCents: r.amountCents,
      completedAt: r.completedAt ?? r.createdAt,
    })),
    receipts: receiptRows.map(({ receipt, bookingStartsAt }) => ({
      date: receipt.date as LocalDate,
      category: receipt.revenueCategory as RevenueCategory,
      amountCents: receipt.amountCents,
      ...(bookingStartsAt !== null && { booking: { startsAt: bookingStartsAt } }),
    })),
    expenses: expenseRows.map((e) => ({
      date: e.date as LocalDate,
      categoryId: e.categoryId,
      amountCents: e.amountCents,
    })),
  };
}

async function entriesFor(db: Conn, regime: Regime, from: LocalDate, to: LocalDate) {
  return recognize({ regime, ...(await loadFacts(db, { from, to })) });
}

async function categoriesInOrder(db: Conn) {
  return db
    .select({
      id: expenseCategories.id,
      name: expenseCategories.name,
      displayOrder: expenseCategories.displayOrder,
    })
    .from(expenseCategories)
    .orderBy(asc(expenseCategories.displayOrder), asc(expenseCategories.name));
}

/**
 * `GET /admin/finance/summary` (`FinanceSummary` of design "Data Models"): buckets and totals of
 * the range, the previous range of equal length with deltas, and per-category breakdowns.
 */
export async function buildSummary(db: Conn, query: FinanceQuery) {
  const { from, to, grouping, regime } = query;
  const previous = previousRange(from, to);
  const entries: Entry[] = await entriesFor(db, regime, previous.from, to);
  const current = summarize(entries, from, to, grouping);
  const before = summarize(entries, previous.from, previous.to, grouping);
  const categories = await categoriesInOrder(db);
  return {
    regime,
    grouping,
    from,
    to,
    buckets: current.buckets,
    totals: current.totals,
    previous: { from: previous.from, to: previous.to, ...before.totals },
    comparison: compare(current.totals, before.totals),
    byRevenueCategory: current.byRevenueCategory,
    byExpenseCategory: categories
      .filter((c) => (current.byExpenseCategory[c.id] ?? 0) !== 0)
      .map((c) => ({ id: c.id, name: c.name, cents: current.byExpenseCategory[c.id] ?? 0 })),
  };
}
export type FinanceSummary = Awaited<ReturnType<typeof buildSummary>>;

/** The DRE matrix of `[from, to]` in one regime (GES-30..GES-33). */
export async function buildDreMatrix(
  db: Conn,
  query: { from: LocalDate; to: LocalDate; regime: Regime },
): Promise<DreMatrix> {
  const entries = await entriesFor(db, query.regime, query.from, query.to);
  return buildDre(entries, query.from, query.to, await categoriesInOrder(db));
}
