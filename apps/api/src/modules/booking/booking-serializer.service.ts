import {
  bookingStatusLabel,
  evaluateReschedule,
  paymentStatusOf,
  renderPolicyText,
  utcToLocal,
  type BookingDetail,
  type BookingStatus,
  type BookingSummary,
  type PaymentMode,
  type PolicySnapshot,
  type QuoteSegment,
  type ReschedulePolicy,
} from '@bravo/core';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Db, Tx } from '../../db/client';
import {
  bookingRescheduleRequests,
  bookingSegments,
  bookings,
  charges,
  refunds,
  rooms,
} from '../../db/schema';
import type { BookingRow, Registry } from '../../extensions/registry';
import { notFound } from '../../lib/errors';

type Handlers = Pick<Registry, 'paymentModeHandlers'>;

/** The policy values frozen on the booking at creation (NUC-31); they win over today's settings. */
export const snapshotOf = (booking: Pick<BookingRow, 'policySnapshot'>): PolicySnapshot =>
  booking.policySnapshot as PolicySnapshot;

export function reschedulePolicyOf(snapshot: PolicySnapshot): ReschedulePolicy {
  return {
    freeCount: snapshot['policy.reschedule_free_count'],
    minHoursBefore: snapshot['policy.reschedule_min_hours_before'],
    windowDays: snapshot['policy.reschedule_window_days'],
  };
}

const MONEY_MODES: readonly PaymentMode[] = ['deposit_balance', 'full_upfront', 'manual'];

/** Package and subscription bookings move minutes, which only a registered handler may do. */
export function handlerFor(registry: Handlers | undefined, mode: PaymentMode) {
  return registry?.paymentModeHandlers.find((h) => h.mode === mode);
}

export const needsModeHandler = (mode: PaymentMode, kind: string): boolean =>
  !MONEY_MODES.includes(mode) || kind === 'fixed_occurrence';

/** What the booking page may offer right now (NUC-141), from status, frozen policy and `now`. */
export function computeActions(
  booking: BookingRow,
  now: Date,
  registry?: Handlers,
): BookingDetail['actions'] {
  const status = booking.status as BookingStatus;
  const holding = status === 'awaiting_payment' || status === 'pre_reserved';
  const canPay =
    holding &&
    booking.holdExpiresAt !== null &&
    booking.holdExpiresAt > now &&
    booking.depositCents - booking.paidCents > 0;
  const canPayBalance =
    status === 'confirmed' &&
    booking.balanceCents > 0 &&
    booking.balanceDueAt !== null &&
    booking.balanceDueAt > now;

  let blocked: BookingDetail['actions']['rescheduleBlockedReason'] = null;
  if (status !== 'confirmed' && status !== 'paid') {
    blocked = 'status';
  } else if (
    needsModeHandler(booking.paymentMode as PaymentMode, booking.kind) &&
    handlerFor(registry, booking.paymentMode as PaymentMode)?.reschedule === undefined
  ) {
    blocked = 'payment_mode';
  } else {
    const verdict = evaluateReschedule({
      startsAt: booking.startsAt,
      newStartsAt: now,
      now,
      rescheduleCount: booking.rescheduleCount,
      isStaffException: false,
      policy: reschedulePolicyOf(snapshotOf(booking)),
    });
    if (!verdict.allowed && verdict.reason !== 'beyond_window') blocked = verdict.reason;
  }
  return {
    canPay,
    canPayBalance,
    canReschedule: blocked === null,
    rescheduleBlockedReason: blocked,
    canCancel: status === 'awaiting_payment' || status === 'confirmed' || status === 'paid',
  };
}

interface SummaryExtras {
  roomSlug: string;
  roomName: string;
  refundedCents: number;
}

export function toBookingSummary(booking: BookingRow, extras: SummaryExtras): BookingSummary {
  const status = booking.status as BookingStatus;
  return {
    id: booking.id,
    code: booking.code,
    kind: booking.kind as BookingSummary['kind'],
    roomId: booking.roomId,
    roomSlug: extras.roomSlug,
    roomName: extras.roomName,
    startsAt: booking.startsAt.toISOString(),
    endsAt: booking.endsAt.toISOString(),
    status,
    statusLabel: bookingStatusLabel[status],
    paymentStatus: paymentStatusOf({
      status,
      paymentMode: booking.paymentMode as PaymentMode,
      balanceCents: booking.balanceCents,
      refundedCents: extras.refundedCents,
    }),
    totalCents: booking.totalCents,
    paidCents: booking.paidCents,
    balanceCents: booking.balanceCents,
    balanceDueAt: booking.balanceDueAt?.toISOString() ?? null,
    holdExpiresAt: booking.holdExpiresAt?.toISOString() ?? null,
    group: null,
  };
}

/** Sum of approved refunds per booking id, for the `refunded` payment status. */
export async function refundedCentsByBooking(
  db: Db | Tx,
  bookingIds: string[],
): Promise<Map<string, number>> {
  const totals = new Map<string, number>();
  if (bookingIds.length === 0) return totals;
  const rows = await db
    .select({
      bookingId: refunds.bookingId,
      total: sql<number>`coalesce(sum(${refunds.amountCents}), 0)::int`,
    })
    .from(refunds)
    .where(and(eq(refunds.status, 'approved'), inArray(refunds.bookingId, bookingIds)))
    .groupBy(refunds.bookingId);
  for (const row of rows) if (row.bookingId !== null) totals.set(row.bookingId, row.total);
  return totals;
}

export function toQuoteSegment(row: typeof bookingSegments.$inferSelect): QuoteSegment {
  const startMinute = utcToLocal(row.startsAt).minuteOfDay;
  return {
    startMinute,
    // The end is derived from the start: a segment that ends at midnight has no local minute 1440.
    endMinute: startMinute + row.minutes,
    minutes: row.minutes,
    categoryId: row.categoryId,
    categoryName: row.categoryName,
    dayType: row.dayType as QuoteSegment['dayType'],
    rateCentsPerHour: row.rateCentsPerHour,
    amountCents: row.amountCents,
  };
}

/** The owner's view of a booking (NUC-141): money, history, frozen policy text and allowed actions. */
export async function loadBookingDetail(
  db: Db | Tx,
  booking: BookingRow,
  now: Date,
  registry?: Handlers,
): Promise<BookingDetail> {
  const [room] = await db.select().from(rooms).where(eq(rooms.id, booking.roomId));
  if (room === undefined) throw notFound();
  const [segmentRows, chargeRows, refundRows, requestRows, refunded] = await Promise.all([
    db
      .select()
      .from(bookingSegments)
      .where(eq(bookingSegments.bookingId, booking.id))
      .orderBy(asc(bookingSegments.seq)),
    db
      .select()
      .from(charges)
      .where(eq(charges.bookingId, booking.id))
      .orderBy(asc(charges.createdAt)),
    db
      .select()
      .from(refunds)
      .where(eq(refunds.bookingId, booking.id))
      .orderBy(asc(refunds.createdAt)),
    db
      .select()
      .from(bookingRescheduleRequests)
      .where(
        and(
          eq(bookingRescheduleRequests.bookingId, booking.id),
          eq(bookingRescheduleRequests.status, 'pending'),
        ),
      ),
    refundedCentsByBooking(db, [booking.id]),
  ]);
  const pending = requestRows[0];
  const snapshot = snapshotOf(booking);
  return {
    ...toBookingSummary(booking, {
      roomSlug: room.slug,
      roomName: room.name,
      refundedCents: refunded.get(booking.id) ?? 0,
    }),
    segments: segmentRows.map(toQuoteSegment),
    grossCents: booking.grossCents,
    discountCents: booking.discountCents,
    discountSource: booking.discountSource as BookingDetail['discountSource'],
    creditAppliedCents: booking.creditAppliedCents,
    depositCents: booking.depositCents,
    paymentMode: booking.paymentMode as PaymentMode,
    cleanupMinutes: booking.cleanupMinutes,
    rescheduleCount: booking.rescheduleCount,
    checkedInAt: booking.checkedInAt?.toISOString() ?? null,
    source: booking.source as BookingDetail['source'],
    charges: chargeRows.map((c) => ({
      id: c.id,
      purpose: c.purpose as BookingDetail['charges'][number]['purpose'],
      method: c.method as BookingDetail['charges'][number]['method'],
      amountCents: c.amountCents,
      status: c.status as BookingDetail['charges'][number]['status'],
      createdAt: c.createdAt.toISOString(),
      approvedAt: c.approvedAt?.toISOString() ?? null,
    })),
    refunds: refundRows.map((r) => ({
      id: r.id,
      amountCents: r.amountCents,
      status: r.status as 'pending' | 'approved' | 'failed',
      createdAt: r.createdAt.toISOString(),
    })),
    pendingReschedule:
      pending === undefined || pending.chargeId === null
        ? null
        : {
            id: pending.id,
            startsAt: pending.newStartsAt.toISOString(),
            endsAt: pending.newEndsAt.toISOString(),
            payNowCents: pending.payNowCents,
            expiresAt: pending.expiresAt.toISOString(),
            chargeId: pending.chargeId,
          },
    policy: { version: snapshot['policy.version'], sections: renderPolicyText(snapshot) },
    actions: computeActions(booking, now, registry),
  };
}

/** The booking of `userId`, or 404: other users' bookings are indistinguishable from missing ones. */
export async function loadOwnedBooking(
  db: Db | Tx,
  bookingId: string,
  userId: string,
): Promise<BookingRow> {
  const [booking] = await db
    .select()
    .from(bookings)
    .where(and(eq(bookings.id, bookingId), eq(bookings.userId, userId)));
  if (booking === undefined) throw notFound();
  return booking;
}
