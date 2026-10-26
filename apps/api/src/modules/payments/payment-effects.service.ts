import type { BookingStatus, Cents } from '@bravo/core';
import { and, eq, sql } from 'drizzle-orm';
import type { Tx } from '../../db/client';
import {
  bookingRescheduleRequests,
  bookings,
  charges,
  refunds,
  roomOccupancy,
} from '../../db/schema';
import {
  notifyStaffAfterCommit,
  type BookingRow,
  type ChargePurposeHandled,
  type ChargeRow,
  type NormalizedStatus,
  type StaffEvent,
} from '../../extensions/registry';
import { audit, type RequestContext } from '../../lib/audit';
import { dispatchEmails } from '../../lib/email';
import { sqlStateOf } from '../../lib/errors';
import { logger } from '../../lib/logger';
import type { ProviderId } from '../../payments/gateway';
import { suggestFreeSlots } from '../availability/availability.service';
import { bookingMailer, loadBookingMailContext } from '../booking/booking-mailer';
import { rescheduleRequestHook } from '../booking/reschedule-hook';
import { transitionBooking } from '../booking/transition';
import type { PaymentDeps } from './charges.service';
import { processRefund, requestRefund } from './refunds.service';

/** Context of effects that nobody requested: webhooks, reconciliation. */
export const SYSTEM_CONTEXT: RequestContext = {
  actorUserId: null,
  actorRole: null,
  origin: 'system',
  ip: null,
  requestId: null,
};

export interface ProviderStatusUpdate {
  provider: ProviderId;
  /** The provider's payment id; for card preferences it is learned here (`charges.external_id`). */
  externalId?: string | null;
  /** Our charge id, when the provider echoes it (`external_reference`) or the caller knows it. */
  chargeId?: string | undefined;
  status: NormalizedStatus;
  /** Amount the provider reports; a difference from the charge is NUC-116. */
  amountCents?: Cents | undefined;
  feeCents?: Cents | undefined;
  raw?: unknown;
}

export type ApplyOutcome =
  'applied' | 'noop' | 'unknown_charge' | 'amount_mismatch' | 'refunded_unusable';

const BOOKING_PURPOSES = [
  'booking_deposit',
  'booking_full',
  'booking_balance',
  'booking_difference',
];
const REOPENABLE = ['pending', 'cancelled', 'expired', 'rejected'];
const HOLDING: BookingStatus[] = ['awaiting_payment', 'pre_reserved'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Effects {
  emailIds: string[];
  staff: { event: StaffEvent; payload: { entityId: string } & Record<string, unknown> }[];
  refundIds: string[];
}

async function findCharge(tx: Tx, update: ProviderStatusUpdate): Promise<ChargeRow | null> {
  if (update.externalId) {
    const [byExternal] = await tx
      .select()
      .from(charges)
      .where(and(eq(charges.provider, update.provider), eq(charges.externalId, update.externalId)))
      .for('update');
    if (byExternal !== undefined) return byExternal;
  }
  if (update.chargeId !== undefined && UUID.test(update.chargeId)) {
    const [byId] = await tx
      .select()
      .from(charges)
      .where(and(eq(charges.id, update.chargeId), eq(charges.provider, update.provider)))
      .for('update');
    if (byId !== undefined) return byId;
  }
  return null;
}

function mergedRaw(charge: ChargeRow, raw: unknown): unknown {
  const previous =
    charge.rawLast !== null && typeof charge.rawLast === 'object' ? charge.rawLast : {};
  return raw === undefined ? previous : { ...previous, response: raw };
}

/** Reinstates the inactive occupancy of an expired booking; false when another one holds the slot. */
async function reinstateOccupancy(tx: Tx, booking: BookingRow): Promise<boolean> {
  try {
    await tx.transaction(async (savepoint) => {
      const rows = await savepoint
        .update(roomOccupancy)
        .set({ active: true, updatedAt: sql`now()` })
        .where(and(eq(roomOccupancy.kind, 'booking'), eq(roomOccupancy.refId, booking.id)))
        .returning({ id: roomOccupancy.id });
      if (rows.length > 0) return;
      const until = new Date(booking.endsAt.getTime() + booking.cleanupMinutes * 60_000);
      await savepoint.insert(roomOccupancy).values({
        roomId: booking.roomId,
        period: `[${booking.startsAt.toISOString()},${until.toISOString()})`,
        kind: 'booking',
        refId: booking.id,
      });
    });
    return true;
  } catch (error) {
    if (sqlStateOf(error) === '23P01') return false;
    throw error;
  }
}

async function refundUnusable(
  tx: Tx,
  charge: ChargeRow,
  ctx: RequestContext,
  fx: Effects,
  why: string,
): Promise<void> {
  const refund = await requestRefund(tx, {
    chargeId: charge.id,
    amountCents: charge.amountCents,
    reason: 'late_approval_conflict',
    ctx,
  });
  fx.refundIds.push(refund.id);
  await audit(tx, ctx, {
    action: 'payment.refund_unusable',
    entityType: 'charge',
    entityId: charge.id,
    after: { why, refundId: refund.id, amountCents: charge.amountCents },
  });
}

/** First confirmation of a booking: money, state, steps, e-mail and staff notice. */
async function confirmBooking(
  tx: Tx,
  deps: PaymentDeps,
  booking: BookingRow,
  charge: ChargeRow,
  ctx: RequestContext,
  fx: Effects,
  from: BookingStatus[],
  reason: string,
): Promise<void> {
  const paidCents = booking.paidCents + charge.amountCents;
  const balanceCents = Math.max(0, booking.totalCents - paidCents);
  const confirmed = await transitionBooking(
    tx,
    ctx,
    booking.id,
    from,
    balanceCents === 0 ? 'paid' : 'confirmed',
    reason,
    { chargeId: charge.id, purpose: charge.purpose, amountCents: charge.amountCents },
    { paidCents, balanceCents },
  );
  for (const step of deps.registry.checkoutSteps) {
    await step.onConfirmed?.(tx, confirmed);
  }
  const mail = await loadBookingMailContext(tx, confirmed, deps.env);
  fx.emailIds.push(await bookingMailer.confirmed(tx, confirmed, mail));
  fx.staff.push({ event: 'new_booking', payload: { entityId: booking.id, code: booking.code } });
}

async function lateApproval(
  tx: Tx,
  deps: PaymentDeps,
  booking: BookingRow,
  charge: ChargeRow,
  ctx: RequestContext,
  fx: Effects,
): Promise<ApplyOutcome> {
  if (await reinstateOccupancy(tx, booking)) {
    await confirmBooking(tx, deps, booking, charge, ctx, fx, ['expired'], 'late_approval');
    return 'applied';
  }
  // Someone else holds the slot now: give the money back and offer three alternatives (NUC-117).
  await refundUnusable(tx, charge, ctx, fx, 'slot_taken');
  const suggestions = await suggestFreeSlots(tx, {
    roomId: booking.roomId,
    durationMinutes: booking.durationMinutes,
    from: deps.now(),
    days: 14,
    count: 3,
  });
  const mail = await loadBookingMailContext(tx, booking, deps.env);
  fx.emailIds.push(
    await bookingMailer.lateApprovalRefund(tx, booking, mail, {
      chargeId: charge.id,
      refundCents: charge.amountCents,
      suggestions,
    }),
  );
  await audit(tx, ctx, {
    action: 'booking.late_approval_refund',
    entityType: 'booking',
    entityId: booking.id,
    after: { chargeId: charge.id, suggestions: suggestions.length },
  });
  return 'refunded_unusable';
}

async function applyBookingEffects(
  tx: Tx,
  deps: PaymentDeps,
  charge: ChargeRow,
  ctx: RequestContext,
  fx: Effects,
): Promise<ApplyOutcome> {
  if (charge.bookingId === null) return 'applied';
  const [booking] = await tx
    .select()
    .from(bookings)
    .where(eq(bookings.id, charge.bookingId))
    .for('update');
  if (booking === undefined) return 'applied';

  const [request] = await tx
    .select()
    .from(bookingRescheduleRequests)
    .where(
      and(
        eq(bookingRescheduleRequests.chargeId, charge.id),
        eq(bookingRescheduleRequests.status, 'pending'),
      ),
    );
  if (request !== undefined) {
    // The tenant reschedule owns this payment (AD-032): it moves the booking and the money.
    if (rescheduleRequestHook.apply === null) {
      logger.warn('reschedule request payment without an applier', { requestId: request.id });
    } else {
      await rescheduleRequestHook.apply(tx, ctx, request, 'approved');
    }
    return 'applied';
  }

  const status = booking.status as BookingStatus;
  if (charge.purpose === 'booking_deposit' || charge.purpose === 'booking_full') {
    if (HOLDING.includes(status)) {
      await confirmBooking(tx, deps, booking, charge, ctx, fx, HOLDING, 'payment_approved');
      return 'applied';
    }
    if (status === 'expired') return lateApproval(tx, deps, booking, charge, ctx, fx);
    // Cancelled, already paid by another charge, completed ...: the money has no booking to serve.
    await refundUnusable(tx, charge, ctx, fx, `booking_${status}`);
    return 'refunded_unusable';
  }

  // booking_balance / booking_difference
  if (status !== 'confirmed') {
    await refundUnusable(tx, charge, ctx, fx, `booking_${status}`);
    return 'refunded_unusable';
  }
  const paidCents = booking.paidCents + charge.amountCents;
  const balanceCents = Math.max(0, booking.totalCents - paidCents);
  const data = { chargeId: charge.id, purpose: charge.purpose, amountCents: charge.amountCents };
  const settled =
    balanceCents === 0
      ? await transitionBooking(tx, ctx, booking.id, ['confirmed'], 'paid', 'balance_paid', data, {
          paidCents,
          balanceCents,
        })
      : (
          await tx
            .update(bookings)
            .set({ paidCents, balanceCents, updatedAt: sql`now()` })
            .where(eq(bookings.id, booking.id))
            .returning()
        )[0];
  if (settled !== undefined) {
    const mail = await loadBookingMailContext(tx, settled, deps.env);
    fx.emailIds.push(
      await bookingMailer.balanceCharged(tx, settled, mail, { chargeId: charge.id }),
    );
  }
  return 'applied';
}

async function approve(
  tx: Tx,
  deps: PaymentDeps,
  charge: ChargeRow,
  update: ProviderStatusUpdate,
  ctx: RequestContext,
  fx: Effects,
): Promise<ApplyOutcome> {
  if (!REOPENABLE.includes(charge.status)) return 'noop';
  const now = deps.now();
  const [approved] = await tx
    .update(charges)
    .set({
      status: 'approved',
      approvedAt: now,
      feeCents: update.feeCents ?? charge.feeCents,
      externalId: charge.externalId ?? update.externalId ?? null,
      rawLast: mergedRaw(charge, update.raw),
      updatedAt: now,
    })
    .where(eq(charges.id, charge.id))
    .returning();
  if (approved === undefined) return 'noop';

  if (update.amountCents !== undefined && update.amountCents !== approved.amountCents) {
    await audit(tx, ctx, {
      action: 'payment.amount_mismatch',
      entityType: 'charge',
      entityId: approved.id,
      after: { expectedCents: approved.amountCents, receivedCents: update.amountCents },
    });
    fx.staff.push({
      event: 'payment_issue',
      payload: { entityId: approved.id, reason: 'amount_mismatch' },
    });
    return 'amount_mismatch';
  }

  fx.staff.push({
    event: 'payment_received',
    payload: {
      entityId: approved.id,
      purpose: approved.purpose,
      amountCents: approved.amountCents,
    },
  });
  if (BOOKING_PURPOSES.includes(approved.purpose)) {
    return applyBookingEffects(tx, deps, approved, ctx, fx);
  }
  const handler = deps.registry.chargeHandlers[approved.purpose as ChargePurposeHandled];
  if (handler === undefined) {
    logger.error('approved charge without a purpose handler', {
      chargeId: approved.id,
      purpose: approved.purpose,
    });
    fx.staff.push({
      event: 'payment_issue',
      payload: { entityId: approved.id, reason: 'unhandled_purpose' },
    });
    return 'applied';
  }
  await handler.onApproved(tx, ctx, approved);
  return 'applied';
}

async function fail(
  tx: Tx,
  deps: PaymentDeps,
  charge: ChargeRow,
  update: ProviderStatusUpdate,
  ctx: RequestContext,
): Promise<ApplyOutcome> {
  if (charge.status !== 'pending') return 'noop';
  const [failed] = await tx
    .update(charges)
    .set({ status: update.status, rawLast: mergedRaw(charge, update.raw), updatedAt: deps.now() })
    .where(and(eq(charges.id, charge.id), eq(charges.status, 'pending')))
    .returning();
  if (failed === undefined) return 'noop';
  if (BOOKING_PURPOSES.includes(failed.purpose)) {
    // A rejected booking charge keeps the hold (NUC-118), except a reschedule difference.
    const [request] = await tx
      .select()
      .from(bookingRescheduleRequests)
      .where(
        and(
          eq(bookingRescheduleRequests.chargeId, failed.id),
          eq(bookingRescheduleRequests.status, 'pending'),
        ),
      );
    if (request !== undefined) await rescheduleRequestHook.apply?.(tx, ctx, request, 'failed');
    return 'applied';
  }
  await deps.registry.chargeHandlers[failed.purpose as ChargePurposeHandled]?.onFailed(
    tx,
    ctx,
    failed,
    update.status,
  );
  return 'applied';
}

/** Refunds and chargebacks decided at the provider (our own refunds already moved the charge). */
async function adjust(
  tx: Tx,
  deps: PaymentDeps,
  charge: ChargeRow,
  update: ProviderStatusUpdate,
  ctx: RequestContext,
  fx: Effects,
): Promise<ApplyOutcome> {
  if (!['approved', 'partially_refunded'].includes(charge.status)) return 'noop';
  if (update.status === 'charged_back') {
    await tx
      .update(charges)
      .set({ status: 'charged_back', updatedAt: deps.now() })
      .where(eq(charges.id, charge.id));
    await audit(tx, ctx, {
      action: 'payment.charged_back',
      entityType: 'charge',
      entityId: charge.id,
    });
    fx.staff.push({
      event: 'payment_issue',
      payload: { entityId: charge.id, reason: 'charged_back' },
    });
    return 'applied';
  }
  const [ours] = await tx
    .select({ id: refunds.id })
    .from(refunds)
    .where(eq(refunds.chargeId, charge.id))
    .limit(1);
  if (ours !== undefined || update.status === charge.status) return 'noop';
  await tx
    .update(charges)
    .set({
      status: update.status,
      ...(update.status === 'refunded' && { refundedCents: charge.amountCents }),
      updatedAt: deps.now(),
    })
    .where(eq(charges.id, charge.id));
  await audit(tx, ctx, {
    action: 'payment.external_refund',
    entityType: 'charge',
    entityId: charge.id,
    after: { status: update.status },
  });
  return 'applied';
}

async function afterCommit(deps: PaymentDeps, fx: Effects, ctx: RequestContext): Promise<void> {
  await dispatchEmails(deps.db, fx.emailIds, { env: deps.env, fetch: deps.fetch });
  for (const { event, payload } of fx.staff) {
    await notifyStaffAfterCommit(deps.registry, event, payload, ctx);
  }
  for (const refundId of fx.refundIds) {
    try {
      await processRefund(deps, refundId, ctx);
    } catch (error) {
      logger.error('refund processing failed', {
        refundId,
        error: { name: (error as Error).name, message: (error as Error).message },
      });
    }
  }
}

/**
 * The single entry of payment effects (AD-034), used by webhooks, the sandbox page and
 * reconciliation: locks the charge, then its booking, and applies the provider status once.
 * Repeating the same status is a no-op, so duplicate deliveries are harmless (NUC-113).
 *
 * Approved booking charges confirm or settle the booking (NUC-115); late approvals on an expired
 * booking reinstate it or refund (NUC-117); a different amount leaves the booking alone
 * (NUC-116); other purposes go to `registry.chargeHandlers` inside the same transaction
 * (NUC-209). E-mails, staff notices and refund calls run after commit.
 */
export async function applyProviderStatus(
  deps: PaymentDeps,
  update: ProviderStatusUpdate,
  ctx: RequestContext = SYSTEM_CONTEXT,
): Promise<{ outcome: ApplyOutcome; chargeId: string | null }> {
  const fx: Effects = { emailIds: [], staff: [], refundIds: [] };
  const result = await deps.db.transaction(async (tx) => {
    const charge = await findCharge(tx, update);
    if (charge === null) return { outcome: 'unknown_charge' as const, chargeId: null };
    let outcome: ApplyOutcome;
    switch (update.status) {
      case 'approved':
        outcome = await approve(tx, deps, charge, update, ctx, fx);
        break;
      case 'rejected':
      case 'cancelled':
      case 'expired':
        outcome = await fail(tx, deps, charge, update, ctx);
        break;
      case 'refunded':
      case 'partially_refunded':
      case 'charged_back':
        outcome = await adjust(tx, deps, charge, update, ctx, fx);
        break;
      case 'pending':
        outcome = 'noop';
        break;
    }
    return { outcome, chargeId: charge.id };
  });
  await afterCommit(deps, fx, ctx);
  return result;
}
