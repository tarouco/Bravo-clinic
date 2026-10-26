import { and, asc, eq, inArray, lte } from 'drizzle-orm';
import type { Tx } from '../db/client';
import { bookingRescheduleRequests, bookings, charges, idempotencyKeys } from '../db/schema';
import { flushAfterCommit, newAfterCommit } from '../modules/booking/effects';
import { expireHoldingBooking } from '../modules/booking/expire-booking';
import { closeRescheduleRequest } from '../modules/booking/reschedule.service';
import { JOB_CONTEXT, type Job } from './runner';

/** Per-run cap: the next 5-minute run takes the rest. */
const BATCH = 200;

/** Same lock order as the payment effects (charges, then the booking), so the two never deadlock. */
async function lockChargesOf(tx: Tx, bookingId: string): Promise<void> {
  await tx
    .select({ id: charges.id })
    .from(charges)
    .where(eq(charges.bookingId, bookingId))
    .orderBy(asc(charges.id))
    .for('update');
}

/**
 * Expires what ran out of time (NUC-197, NUC-166, NUC-147, NUC-200): single bookings whose hold
 * passed (fixed occurrences belong to receita's purchase job), pre-reservations (with the
 * customer e-mail and the staff event), reschedule requests unpaid past their expiry, and the
 * idempotency keys of the previous day. Each booking has its own transaction and is re-read under
 * lock, so a payment that wins the race simply leaves nothing to expire.
 */
export const expireHolds: Job = async (deps, now) => {
  const stats = { expiredBookings: 0, expiredPreReservations: 0, expiredRescheduleRequests: 0 };

  const holding = await deps.db
    .select({ id: bookings.id })
    .from(bookings)
    .where(
      and(
        inArray(bookings.status, ['awaiting_payment', 'pre_reserved']),
        eq(bookings.kind, 'single'),
        lte(bookings.holdExpiresAt, now),
      ),
    )
    .orderBy(asc(bookings.holdExpiresAt))
    .limit(BATCH);
  for (const { id } of holding) {
    const fx = newAfterCommit();
    const expired = await deps.db.transaction(async (tx) => {
      await lockChargesOf(tx, id);
      const [booking] = await tx.select().from(bookings).where(eq(bookings.id, id)).for('update');
      if (
        booking === undefined ||
        (booking.status !== 'awaiting_payment' && booking.status !== 'pre_reserved') ||
        booking.holdExpiresAt === null ||
        booking.holdExpiresAt > now
      ) {
        return null;
      }
      return expireHoldingBooking(tx, deps, JOB_CONTEXT, booking, fx);
    });
    await flushAfterCommit(deps, fx, JOB_CONTEXT);
    if (expired === null) continue;
    stats.expiredBookings += 1;
    if (fx.staff.some((s) => s.event === 'pre_reservation_expired')) {
      stats.expiredPreReservations += 1;
    }
  }

  const requests = await deps.db
    .select()
    .from(bookingRescheduleRequests)
    .where(
      and(
        eq(bookingRescheduleRequests.status, 'pending'),
        lte(bookingRescheduleRequests.expiresAt, now),
      ),
    )
    .limit(BATCH);
  for (const request of requests) {
    const fx = newAfterCommit();
    const closed = await deps.db.transaction(async (tx) => {
      await lockChargesOf(tx, request.bookingId);
      return closeRescheduleRequest(tx, JOB_CONTEXT, request, 'expired', fx);
    });
    await flushAfterCommit(deps, fx, JOB_CONTEXT);
    if (closed) stats.expiredRescheduleRequests += 1;
  }

  const purged = await deps.db
    .delete(idempotencyKeys)
    .where(lte(idempotencyKeys.expiresAt, now))
    .returning({ key: idempotencyKeys.key });
  return { ...stats, purgedIdempotencyKeys: purged.length };
};
