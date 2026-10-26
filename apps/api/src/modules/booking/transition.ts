import { canTransition, isTerminalStatus, type BookingStatus } from '@bravo/core';
import { and, eq, sql } from 'drizzle-orm';
import type { Tx } from '../../db/client';
import { bookingEvents, bookings, roomOccupancy } from '../../db/schema';
import type { BookingRow } from '../../extensions/registry';
import type { RequestContext } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';

/** Booking columns a transition may change in the same guarded update. */
export type BookingPatch = Partial<
  Pick<
    typeof bookings.$inferInsert,
    | 'paidCents'
    | 'balanceCents'
    | 'holdExpiresAt'
    | 'cancelledAt'
    | 'cancelReason'
    | 'cancelledBy'
    | 'confirmedManuallyBy'
    | 'icsSequence'
    | 'notes'
  >
>;

/**
 * The one door for booking status changes (NUC-05, NUC-06): asserts the state machine, runs the
 * guarded update, appends the `booking_events` row (actor and origin from `ctx`) and, entering a
 * terminal state, deactivates the booking's occupancy in the same transaction.
 *
 * The caller is expected to hold the booking row lock; the status is re-read here under
 * `FOR UPDATE` anyway, so a stale `from` list fails with 409 instead of overwriting.
 */
export async function transitionBooking(
  tx: Tx,
  ctx: RequestContext,
  bookingId: string,
  from: readonly BookingStatus[],
  to: BookingStatus,
  reason: string,
  data?: Record<string, unknown>,
  patch: BookingPatch = {},
): Promise<BookingRow> {
  const [current] = await tx
    .select({ status: bookings.status })
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .for('update');
  if (current === undefined) throw notFound();
  const fromStatus = current.status as BookingStatus;
  if (!from.includes(fromStatus) || !canTransition(fromStatus, to)) {
    throw new AppError(
      409,
      'INVALID_TRANSITION',
      'A reserva não pode mudar para este estado agora.',
      { from: fromStatus, to },
    );
  }
  const [updated] = await tx
    .update(bookings)
    .set({ ...patch, status: to, updatedAt: sql`now()` })
    .where(and(eq(bookings.id, bookingId), eq(bookings.status, fromStatus)))
    .returning();
  if (updated === undefined) {
    throw new AppError(409, 'INVALID_TRANSITION', 'A reserva mudou de estado. Tente novamente.');
  }
  await tx.insert(bookingEvents).values({
    bookingId,
    fromStatus,
    toStatus: to,
    actorUserId: ctx.actorUserId,
    origin: ctx.origin,
    reason,
    data: data ?? null,
  });
  if (isTerminalStatus(to)) {
    await tx
      .update(roomOccupancy)
      .set({ active: false, updatedAt: sql`now()` })
      .where(
        and(
          eq(roomOccupancy.kind, 'booking'),
          eq(roomOccupancy.refId, bookingId),
          eq(roomOccupancy.active, true),
        ),
      );
  }
  return updated;
}
