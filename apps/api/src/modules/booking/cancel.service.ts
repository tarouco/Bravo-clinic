import {
  evaluateCancellation,
  type BookingStatus,
  type CancelPolicy,
  type CancellationResult,
  type ClinicCancelOption,
  type PaymentMode,
} from '@bravo/core';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { Tx } from '../../db/client';
import { bookingRescheduleRequests, bookings, charges, refunds } from '../../db/schema';
import type { BookingRow, Registry } from '../../extensions/registry';
import { audit, type RequestContext } from '../../lib/audit';
import { AppError, conflict, notFound } from '../../lib/errors';
import type { PaymentDeps } from '../payments/charges.service';
import { requestRefund } from '../payments/refunds.service';
import { bookingMailer, loadBookingMailContext } from './booking-mailer';
import { handlerFor, needsModeHandler, snapshotOf } from './booking-serializer.service';
import { flushAfterCommit, newAfterCommit } from './effects';
import { cancelPendingCharges } from './expire-booking';
import { closeRescheduleRequest } from './reschedule.service';
import { transitionBooking } from './transition';

export type CancelActor = 'tenant' | 'clinic';

const unsupportedMode = () =>
  new AppError(
    422,
    'POLICY_VIOLATION',
    'O cancelamento deste tipo de reserva é feito pela recepção.',
    { reason: 'unsupported_payment_mode' },
  );

/** The cancellation values frozen on the booking (NUC-31, CA-10). */
export function cancelPolicyOf(booking: BookingRow): CancelPolicy {
  const snapshot = snapshotOf(booking);
  return {
    cancelRefundMinHoursBefore: snapshot['policy.cancel_refund_min_hours_before'],
    packageCancelReturnMinHoursBefore: snapshot['policy.package_cancel_return_min_hours_before'],
    depositRefundable: snapshot['payment.deposit_refundable'],
    clinicCancelOptions: snapshot['policy.clinic_cancel_options'],
  };
}

function evaluate(booking: BookingRow, now: Date, actor: CancelActor): CancellationResult {
  return evaluateCancellation({
    actor,
    startsAt: booking.startsAt,
    now,
    kind: booking.kind as 'single' | 'fixed_occurrence',
    paymentMode: booking.paymentMode as PaymentMode,
    depositCents: booking.depositCents,
    paidCents: booking.paidCents,
    // The minutes receita debited (T13); its mode handler decides where they go back.
    packageMinutes: booking.packageMinutesDebited,
    extraMinutes: booking.extraMinutesDebited,
    withinCurrentPeriod: true,
    policy: cancelPolicyOf(booking),
  });
}

const CANCELLABLE: Record<CancelActor, readonly BookingStatus[]> = {
  tenant: ['awaiting_payment', 'confirmed', 'paid'],
  clinic: ['awaiting_payment', 'pre_reserved', 'held_for_renewal', 'confirmed', 'paid'],
};

function assertCancellable(booking: BookingRow, actor: CancelActor): void {
  if (!CANCELLABLE[actor].includes(booking.status as BookingStatus)) {
    throw conflict('INVALID_TRANSITION', 'A reserva não pode ser cancelada agora.');
  }
}

function assertModeHandled(booking: BookingRow, registry: Pick<Registry, 'paymentModeHandlers'>) {
  const mode = booking.paymentMode as PaymentMode;
  if (needsModeHandler(mode, booking.kind) && handlerFor(registry, mode)?.cancel === undefined) {
    throw unsupportedMode();
  }
}

/** What the clinic may choose when it cancels: the frozen options, `credit` only with a live port. */
export function clinicOptionsOf(
  booking: BookingRow,
  registry: Pick<Registry, 'credits'>,
): ClinicCancelOption[] {
  return cancelPolicyOf(booking).clinicCancelOptions.filter(
    (option) => option !== 'credit' || registry.credits.mode === 'live',
  );
}

/**
 * Money and minutes a cancellation would keep and return (NUC-150), from the booking's own
 * snapshot. The clinic's preview also lists the options it may pick.
 */
export function previewCancellation(
  booking: BookingRow,
  now: Date,
  actor: CancelActor,
  registry: Pick<Registry, 'paymentModeHandlers' | 'credits'>,
) {
  assertCancellable(booking, actor);
  assertModeHandled(booking, registry);
  const result = evaluate(booking, now, actor);
  return {
    retainedCents: result.retainedCents,
    refundCents: result.refundCents,
    minutesReturned: result.minutesReturned,
    creditCents: actor === 'clinic' && registry.credits.mode === 'live' ? result.refundCents : 0,
    clinicOptions: actor === 'clinic' ? clinicOptionsOf(booking, registry) : [],
  };
}

/** Refund requests from the newest approved charges first, never beyond what each can still return. */
async function refundNewestFirst(
  tx: Tx,
  booking: BookingRow,
  amountCents: number,
  reason: 'tenant_cancel' | 'clinic_cancel',
  ctx: RequestContext,
): Promise<string[]> {
  if (amountCents <= 0) return [];
  const approved = await tx
    .select()
    .from(charges)
    .where(
      and(
        eq(charges.bookingId, booking.id),
        inArray(charges.status, ['approved', 'partially_refunded']),
        // Credit paid through receita's internal charges goes back via the credit step (REC-109).
        ne(charges.provider, 'internal'),
      ),
    )
    .orderBy(desc(charges.approvedAt), desc(charges.createdAt));
  const pendingByCharge = new Map<string, number>();
  if (approved.length > 0) {
    const pending = await tx
      .select({
        chargeId: refunds.chargeId,
        total: sql<number>`coalesce(sum(${refunds.amountCents}), 0)::int`,
      })
      .from(refunds)
      .where(
        and(
          inArray(
            refunds.chargeId,
            approved.map((c) => c.id),
          ),
          eq(refunds.status, 'pending'),
        ),
      )
      .groupBy(refunds.chargeId);
    for (const row of pending) pendingByCharge.set(row.chargeId, row.total);
  }
  const ids: string[] = [];
  let remaining = amountCents;
  for (const charge of approved) {
    if (remaining <= 0) break;
    const available =
      charge.amountCents - charge.refundedCents - (pendingByCharge.get(charge.id) ?? 0);
    const take = Math.min(remaining, available);
    if (take <= 0) continue;
    const refund = await requestRefund(tx, {
      chargeId: charge.id,
      amountCents: take,
      reason,
      ctx,
    });
    ids.push(refund.id);
    remaining -= take;
  }
  return ids;
}

export interface CancelInput {
  bookingId: string;
  actor: { kind: 'tenant'; userId: string } | { kind: 'clinic' };
  reason?: string | undefined;
  /** Clinic only: what the customer gets back (NUC-153). */
  resolution?: ClinicCancelOption | undefined;
  justification?: string | undefined;
}

/**
 * Cancels a booking (NUC-151..NUC-153, NUC-175): the tenant's own (refunds as the frozen policy
 * says, newest charges first; an unpaid checkout just closes) or the clinic's (everything paid
 * back, or credited when the port is live). Occupancy is freed by the transition; pending charges
 * and a pending reschedule request are cancelled; checkout steps release what they hold; the
 * customer gets `booking.cancelled` with `METHOD:CANCEL` and the staff are notified.
 */
export async function cancelBooking(
  deps: PaymentDeps,
  ctx: RequestContext,
  input: CancelInput,
): Promise<BookingRow> {
  const { db, registry } = deps;
  const now = deps.now();
  const actor: CancelActor = input.actor.kind === 'tenant' ? 'tenant' : 'clinic';
  const fx = newAfterCommit();

  const cancelled = await db.transaction(async (tx) => {
    const [booking] = await tx
      .select()
      .from(bookings)
      .where(
        input.actor.kind === 'tenant'
          ? and(eq(bookings.id, input.bookingId), eq(bookings.userId, input.actor.userId))
          : eq(bookings.id, input.bookingId),
      )
      .for('update');
    if (booking === undefined) throw notFound();
    assertCancellable(booking, actor);
    assertModeHandled(booking, registry);

    const resolution = input.resolution ?? 'refund';
    if (actor === 'clinic') {
      if (!clinicOptionsOf(booking, registry).includes(resolution)) {
        throw new AppError(
          422,
          'POLICY_VIOLATION',
          'Esta opção de cancelamento não está disponível.',
          {
            reason: resolution === 'credit' ? 'credit_unavailable' : 'option_unavailable',
          },
        );
      }
      if (
        resolution === 'minutes' &&
        !needsModeHandler(booking.paymentMode as PaymentMode, booking.kind)
      ) {
        throw new AppError(422, 'POLICY_VIOLATION', 'Esta reserva não foi paga com minutos.', {
          reason: 'option_unavailable',
        });
      }
    }

    const [pending] = await tx
      .select()
      .from(bookingRescheduleRequests)
      .where(
        and(
          eq(bookingRescheduleRequests.bookingId, booking.id),
          eq(bookingRescheduleRequests.status, 'pending'),
        ),
      );
    if (pending !== undefined) await closeRescheduleRequest(tx, ctx, pending, 'cancelled', fx);

    const evaluation = evaluate(booking, now, actor);
    const handler = handlerFor(registry, booking.paymentMode as PaymentMode);
    let minutesReturned = evaluation.minutesReturned;
    if (handler?.cancel !== undefined) {
      minutesReturned = (await handler.cancel(tx, booking, evaluation)).minutesReturned;
    }

    const eventData: Record<string, unknown> = {
      retainedCents: evaluation.retainedCents,
      refundCents: evaluation.refundCents,
      minutesReturned,
      ...(actor === 'clinic' && { resolution }),
    };
    const refundTarget = actor === 'clinic' && resolution !== 'refund' ? 0 : evaluation.refundCents;
    if (actor === 'clinic' && resolution === 'credit' && evaluation.refundCents > 0) {
      const grant = await registry.credits.grant(tx, {
        userId: booking.userId,
        amountCents: evaluation.refundCents,
        source: 'clinic_cancellation',
        refType: 'booking',
        refId: booking.id,
        ctx,
      });
      eventData['creditGrant'] = {
        amountCents: evaluation.refundCents,
        status: 'granted',
        creditLotId: grant.creditLotId,
      };
    }

    const result = await transitionBooking(
      tx,
      ctx,
      booking.id,
      [booking.status as BookingStatus],
      actor === 'tenant' ? 'cancelled_by_tenant' : 'cancelled_by_clinic',
      actor === 'tenant' ? 'cancelled_by_tenant' : 'cancelled_by_clinic',
      eventData,
      {
        cancelledAt: now,
        cancelReason: input.reason ?? null,
        cancelledBy: ctx.actorUserId,
        icsSequence: booking.icsSequence + 1,
      },
    );
    fx.refundIds.push(
      ...(await refundNewestFirst(
        tx,
        booking,
        refundTarget,
        actor === 'tenant' ? 'tenant_cancel' : 'clinic_cancel',
        ctx,
      )),
    );
    await cancelPendingCharges(tx, booking.id, fx);
    for (const step of registry.checkoutSteps) {
      await step.release?.(tx, result, 'cancelled', evaluation);
    }

    const mail = await loadBookingMailContext(tx, result, deps.env);
    fx.emailIds.push(
      await bookingMailer.cancelled(tx, result, mail, { refundCents: refundTarget }),
    );
    fx.staff.push({
      event: 'booking_cancelled',
      payload: { entityId: booking.id, code: booking.code, by: actor },
    });
    await audit(tx, ctx, {
      action: actor === 'clinic' ? 'booking.cancel_by_clinic' : 'booking.cancel',
      entityType: 'booking',
      entityId: booking.id,
      ...(input.justification !== undefined && { justification: input.justification }),
      before: { status: booking.status, paidCents: booking.paidCents },
      after: { status: result.status, reason: input.reason ?? null, ...eventData },
    });
    return result;
  });

  await flushAfterCommit(deps, fx, ctx);
  return cancelled;
}
