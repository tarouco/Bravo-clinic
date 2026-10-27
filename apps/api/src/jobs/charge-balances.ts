import { and, asc, eq, inArray, lte, gt, or, sql } from 'drizzle-orm';
import type { Tx } from '../db/client';
import { bookingRescheduleRequests, bookings, charges } from '../db/schema';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';
import { bookingMailer, loadBookingMailContext } from '../modules/booking/booking-mailer';
import { flushAfterCommit, newAfterCommit } from '../modules/booking/effects';
import { cancelPendingCharges } from '../modules/booking/expire-booking';
import { closeRescheduleRequest } from '../modules/booking/reschedule.service';
import { transitionBooking } from '../modules/booking/transition';
import { createBalanceChargeForBooking } from '../modules/payments/charges.service';
import { listSavedCards } from '../modules/payments/cards.service';
import { JOB_CONTEXT, type Job, type JobDeps } from './runner';

const BATCH = 100;
const BALANCE_PURPOSES = ['booking_balance', 'booking_difference'];

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
 * NUC-132: the balance was not paid by `balance_due_at`. The booking is cancelled for
 * non-payment, the paid sinal stays with the clinic, the slot is freed and the pending charge
 * cancelled; the customer is told by e-mail.
 */
async function cancelForNonpayment(deps: JobDeps, bookingId: string, now: Date): Promise<boolean> {
  const fx = newAfterCommit();
  const done = await deps.db.transaction(async (tx) => {
    await lockChargesOf(tx, bookingId);
    const [booking] = await tx
      .select()
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .for('update');
    if (
      booking === undefined ||
      booking.status !== 'confirmed' ||
      booking.balanceCents <= 0 ||
      booking.balanceDueAt === null ||
      booking.balanceDueAt > now
    ) {
      return false;
    }
    const [pending] = await tx
      .select()
      .from(bookingRescheduleRequests)
      .where(
        and(
          eq(bookingRescheduleRequests.bookingId, bookingId),
          eq(bookingRescheduleRequests.status, 'pending'),
        ),
      );
    if (pending !== undefined) {
      await closeRescheduleRequest(tx, JOB_CONTEXT, pending, 'cancelled', fx);
    }
    const result = await transitionBooking(
      tx,
      JOB_CONTEXT,
      bookingId,
      ['confirmed'],
      'cancelled_nonpayment',
      'balance_not_paid',
      { retainedCents: booking.paidCents, unpaidCents: booking.balanceCents },
      {
        cancelledAt: now,
        cancelReason: 'Saldo não pago no prazo',
        icsSequence: booking.icsSequence + 1,
      },
    );
    await cancelPendingCharges(tx, bookingId, fx);
    for (const step of deps.registry.checkoutSteps) {
      await step.release?.(
        tx,
        result,
        'cancelled',
        {
          retainedCents: booking.paidCents,
          refundCents: 0,
          minutesReturned: 0,
          clinicOptions: [],
        },
        now,
      );
    }
    const mail = await loadBookingMailContext(tx, result, deps.env);
    fx.emailIds.push(await bookingMailer.cancelledNonpayment(tx, result, mail));
    fx.staff.push({
      event: 'booking_cancelled',
      payload: { entityId: bookingId, code: result.code, by: 'nonpayment' },
    });
    return true;
  });
  await flushAfterCommit(deps, fx, JOB_CONTEXT);
  return done;
}

interface ChargeStats {
  cardCharged: number;
  cardPending: number;
  cardFailed: number;
  pixCreated: number;
  failed: number;
}

/** Queues one e-mail about a booking in its own transaction and sends it after commit. */
async function mailBooking(
  deps: JobDeps,
  bookingId: string,
  send: (
    tx: Tx,
    booking: typeof bookings.$inferSelect,
    mail: Awaited<ReturnType<typeof loadBookingMailContext>>,
  ) => Promise<string>,
): Promise<void> {
  const fx = newAfterCommit();
  await deps.db.transaction(async (tx) => {
    const [booking] = await tx.select().from(bookings).where(eq(bookings.id, bookingId));
    if (booking === undefined) return;
    const mail = await loadBookingMailContext(tx, booking, deps.env);
    fx.emailIds.push(await send(tx, booking, mail));
  });
  await flushAfterCommit(deps, fx, JOB_CONTEXT);
}

/**
 * NUC-130, NUC-131: charges the balance of one booking. The newest saved card with recurring
 * consent goes first; a declined or failed card (or no card) ends in a Pix charge that expires at
 * `balance_due_at`, with the matching e-mail.
 */
async function chargeBalance(deps: JobDeps, bookingId: string, stats: ChargeStats): Promise<void> {
  const [booking] = await deps.db.select().from(bookings).where(eq(bookings.id, bookingId));
  if (booking === undefined) return;
  const base = { bookingId, userId: booking.userId };

  const [declined] = await deps.db
    .select({ id: charges.id })
    .from(charges)
    .where(
      and(
        eq(charges.bookingId, bookingId),
        eq(charges.method, 'saved_card'),
        eq(charges.status, 'rejected'),
        inArray(charges.purpose, BALANCE_PURPOSES),
      ),
    )
    .limit(1);
  let cardFailed = declined !== undefined;

  const card =
    declined === undefined
      ? (await listSavedCards(deps.db, booking.userId)).find((c) => c.recurringConsentAt !== null)
      : undefined;
  if (card !== undefined) {
    try {
      const charge = await createBalanceChargeForBooking(deps, JOB_CONTEXT, {
        ...base,
        method: 'saved_card',
        savedCardId: card.id,
      });
      if (charge.status === 'approved') {
        stats.cardCharged += 1;
        return;
      }
      if (charge.status === 'pending') {
        stats.cardPending += 1;
        return;
      }
      cardFailed = true;
    } catch (error) {
      logger.warn('saved card balance charge failed', {
        bookingId,
        error: error instanceof Error ? error.message : String(error),
      });
      cardFailed = true;
    }
    if (cardFailed) stats.cardFailed += 1;
  }

  await createBalanceChargeForBooking(deps, JOB_CONTEXT, { ...base, method: 'pix' });
  stats.pixCreated += 1;
  if (cardFailed) {
    const [failedCharge] = await deps.db
      .select({ id: charges.id })
      .from(charges)
      .where(
        and(
          eq(charges.bookingId, bookingId),
          eq(charges.method, 'saved_card'),
          inArray(charges.purpose, BALANCE_PURPOSES),
        ),
      )
      .orderBy(sql`${charges.createdAt} desc`)
      .limit(1);
    await mailBooking(deps, bookingId, (tx, row, mail) =>
      bookingMailer.balanceCardFailed(tx, row, mail, { chargeId: failedCharge?.id ?? bookingId }),
    );
  } else {
    await mailBooking(deps, bookingId, (tx, row, mail) =>
      bookingMailer.balanceCharge(tx, row, mail),
    );
  }
}

/**
 * Balance collection (NUC-130..NUC-132): first the bookings past their deadline are cancelled for
 * non-payment, then every confirmed booking whose charge time came and that has no pending or
 * approved balance charge gets one. Re-running creates no second charge.
 */
export const chargeBalances: Job = async (deps, now) => {
  let cancelledNonpayment = 0;
  const overdue = await deps.db
    .select({ id: bookings.id })
    .from(bookings)
    .where(
      and(
        eq(bookings.status, 'confirmed'),
        gt(bookings.balanceCents, 0),
        lte(bookings.balanceDueAt, now),
      ),
    )
    .orderBy(asc(bookings.balanceDueAt))
    .limit(BATCH);
  for (const { id } of overdue) {
    try {
      if (await cancelForNonpayment(deps, id, now)) cancelledNonpayment += 1;
    } catch (error) {
      logger.error('nonpayment cancellation failed', {
        bookingId: id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const stats: ChargeStats = {
    cardCharged: 0,
    cardPending: 0,
    cardFailed: 0,
    pixCreated: 0,
    failed: 0,
  };
  const due = await deps.db
    .select({ id: bookings.id })
    .from(bookings)
    .where(
      and(
        eq(bookings.status, 'confirmed'),
        gt(bookings.balanceCents, 0),
        lte(bookings.balanceChargeAt, now),
        gt(bookings.balanceDueAt, now),
        sql`not exists (
          select 1 from ${charges}
          where ${charges.bookingId} = ${bookings.id}
            and (
              (${charges.status} = 'pending' and ${charges.purpose} in ('booking_balance', 'booking_difference'))
              or (${charges.status} = 'approved' and ${charges.purpose} = 'booking_balance')
            )
        )`,
        or(eq(bookings.paymentMode, 'deposit_balance'), eq(bookings.paymentMode, 'full_upfront')),
      ),
    )
    .orderBy(asc(bookings.balanceChargeAt))
    .limit(BATCH);
  for (const { id } of due) {
    try {
      await chargeBalance(deps, id, stats);
    } catch (error) {
      stats.failed += 1;
      logger.error('balance charge failed', {
        bookingId: id,
        error: error instanceof AppError ? error.code : String(error),
      });
    }
  }
  return { cancelledNonpayment, ...stats };
};
