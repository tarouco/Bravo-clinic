import { and, eq, sql } from 'drizzle-orm';
import type { Tx } from '../../db/client';
import { charges } from '../../db/schema';
import type { BookingRow, Registry } from '../../extensions/registry';
import type { RequestContext } from '../../lib/audit';
import type { Env } from '../../env';
import { bookingMailer, loadBookingMailContext } from './booking-mailer';
import type { AfterCommit } from './effects';
import { transitionBooking } from './transition';

/**
 * Cancels every pending charge of the booking in the caller's transaction (guarded update). The
 * rows are queued so the provider is asked after commit (`flushAfterCommit`).
 */
export async function cancelPendingCharges(
  tx: Tx,
  bookingId: string,
  fx: AfterCommit,
): Promise<void> {
  const cancelled = await tx
    .update(charges)
    .set({ status: 'cancelled', updatedAt: sql`now()` })
    .where(and(eq(charges.bookingId, bookingId), eq(charges.status, 'pending')))
    .returning();
  fx.cancelCharges.push(...cancelled);
}

/**
 * Hold ran out (NUC-97, NUC-166, NUC-197): the booking becomes `expired` and frees its slot, its
 * pending charges are cancelled and every checkout step releases what it reserved. An expired
 * pre-reservation also tells the customer and the staff.
 */
export async function expireHoldingBooking(
  tx: Tx,
  deps: { registry: Pick<Registry, 'checkoutSteps'>; env: Pick<Env, 'APP_BASE_URL'> },
  ctx: RequestContext,
  booking: BookingRow,
  fx: AfterCommit,
): Promise<BookingRow> {
  const wasPreReservation = booking.status === 'pre_reserved';
  const expired = await transitionBooking(
    tx,
    ctx,
    booking.id,
    ['awaiting_payment', 'pre_reserved'],
    'expired',
    'hold_expired',
  );
  await cancelPendingCharges(tx, booking.id, fx);
  for (const step of deps.registry.checkoutSteps) {
    await step.release?.(tx, expired, 'expired');
  }
  if (wasPreReservation) {
    const mail = await loadBookingMailContext(tx, expired, deps.env);
    fx.emailIds.push(await bookingMailer.preReservationExpired(tx, expired, mail));
    fx.staff.push({
      event: 'pre_reservation_expired',
      payload: { entityId: expired.id, code: expired.code },
    });
  }
  return expired;
}
