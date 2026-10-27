import {
  evaluateReschedule,
  localToUtc,
  rejectMessage,
  settleReschedule,
  utcToLocal,
  type LocalDate,
  type PaymentMode,
  type Quote,
  type QuoteSegment,
  type RejectReason,
  type RescheduleQuote,
  type RescheduleSettlement,
} from '@bravo/core';
import { and, eq, sql } from 'drizzle-orm';
import type { Db, Tx } from '../../db/client';
import {
  blocks,
  bookingEvents,
  bookingRescheduleRequests,
  bookingSegments,
  bookings,
  charges,
  roomOccupancy,
  users,
} from '../../db/schema';
import type { BookingRow, ChargeRow } from '../../extensions/registry';
import { audit, type RequestContext } from '../../lib/audit';
import { AppError, notFound, sqlStateOf, validationFailed } from '../../lib/errors';
import { suggestFreeSlots } from '../availability/availability.service';
import { lockCalendarDates } from '../calendar/calendar-lock';
import { createHoldBlock } from '../calendar/blocks.service';
import {
  cancelCharge,
  createCharge,
  submitCharge,
  type PayMethod,
  type PaymentDeps,
} from '../payments/charges.service';
import { requestRefund } from '../payments/refunds.service';
import { resolveGatewayForCharge } from '../../payments/resolver';
import { bookingMailer, loadBookingMailContext } from './booking-mailer';
import {
  handlerFor,
  needsModeHandler,
  reschedulePolicyOf,
  snapshotOf,
} from './booking-serializer.service';
import { flushAfterCommit, newAfterCommit, type AfterCommit } from './effects';
import { buildQuote, type BuiltQuote } from './quote.service';
import type {
  RescheduleApplyEffects,
  RescheduleCharge,
  RescheduleRequestRow,
} from './reschedule-hook';
import { transitionBooking } from './transition';

export type RescheduleBlockReason = NonNullable<RescheduleQuote['reason']>;

export interface RescheduleTarget {
  roomSlug: string;
  date: LocalDate;
  startMinute: number;
  endMinute: number;
}

const HOLD_TAG = 'Reagendamento em pagamento';

const slotTaken = () => new AppError(409, 'SLOT_TAKEN', 'Este horário acabou de ser reservado.');

const policyViolation = (reason: RescheduleBlockReason, message: string) =>
  new AppError(422, 'POLICY_VIOLATION', message, { reason });

// --- Evaluation ------------------------------------------------------------------------------

type Evaluation =
  | { ok: false; reason: RescheduleBlockReason; message: string; error: AppError }
  | {
      ok: true;
      built: BuiltQuote;
      settlement: RescheduleSettlement;
      startsAt: Date;
      endsAt: Date;
    };

function refusalMessage(
  booking: BookingRow,
  reason: 'too_late' | 'limit_reached' | 'beyond_window',
) {
  const policy = reschedulePolicyOf(snapshotOf(booking));
  switch (reason) {
    case 'too_late':
      return `O reagendamento só é possível com pelo menos ${String(policy.minHoursBefore)} horas de antecedência.`;
    case 'limit_reached':
      return 'O reagendamento cortesia desta reserva já foi usado. Fale com a recepção.';
    case 'beyond_window':
      return `O novo horário precisa estar dentro dos próximos ${String(policy.windowDays)} dias.`;
  }
}

/**
 * Policy check, interval validation and pricing of a reschedule target (NUC-142, NUC-143). The
 * booking being moved does not count as an occupant of its own target. A refusal is a value, so
 * the quote endpoint can show it; the write path throws its `error`.
 */
async function evaluateTarget(
  db: Db | Tx,
  deps: Pick<PaymentDeps, 'now' | 'registry'>,
  booking: BookingRow,
  target: RescheduleTarget,
  options: { exception: boolean; staff: boolean },
): Promise<Evaluation> {
  const now = deps.now();
  if (booking.status !== 'confirmed' && booking.status !== 'paid') {
    throw new AppError(409, 'INVALID_STATE', 'Esta reserva não pode ser reagendada.');
  }
  const mode = booking.paymentMode as PaymentMode;
  if (
    needsModeHandler(mode, booking.kind) &&
    handlerFor(deps.registry, mode)?.reschedule === undefined
  ) {
    const message = 'O reagendamento deste tipo de reserva é feito pela recepção.';
    return {
      ok: false,
      reason: 'unsupported_payment_mode',
      message,
      error: policyViolation('unsupported_payment_mode', message),
    };
  }
  const startsAt = localToUtc(target.date, target.startMinute);
  const endsAt = localToUtc(target.date, target.endMinute);
  const verdict = evaluateReschedule({
    startsAt: booking.startsAt,
    newStartsAt: startsAt,
    now,
    rescheduleCount: booking.rescheduleCount,
    isStaffException: options.exception,
    policy: reschedulePolicyOf(snapshotOf(booking)),
  });
  if (!verdict.allowed) {
    const message = refusalMessage(booking, verdict.reason);
    return {
      ok: false,
      reason: verdict.reason,
      message,
      error: policyViolation(verdict.reason, message),
    };
  }

  const [owner] = await db
    .select({ id: users.id, docNumber: users.docNumber })
    .from(users)
    .where(eq(users.id, booking.userId));
  if (owner === undefined) throw notFound();
  const built = await buildQuote(
    db,
    {
      roomSlug: target.roomSlug,
      date: target.date,
      startMinute: target.startMinute,
      endMinute: target.endMinute,
    },
    {
      now,
      user: owner,
      registry: deps.registry,
      excludeBookingId: booking.id,
      includeAdminOnly: options.staff,
    },
  );
  if (!built.ok) {
    const { error } = built;
    if (error.code === 'SLOT_UNAVAILABLE') {
      const reason = (error.details as { reason: RescheduleBlockReason }).reason;
      return { ok: false, reason, message: rejectMessage(reason as RejectReason), error };
    }
    if (error.code === 'NO_CATEGORY') {
      return { ok: false, reason: 'no_category', message: error.message, error };
    }
    throw error;
  }
  const settlement = settleReschedule({
    oldNetCents: booking.totalCents,
    newNetCents: built.quote.netCents,
    paidCents: booking.paidCents,
    depositCents: booking.depositCents,
  });
  return { ok: true, built, settlement, startsAt, endsAt };
}

/** `POST /app/bookings/:id/reschedule/quote` (NUC-142): nothing is written. */
export async function quoteReschedule(
  db: Db,
  deps: Pick<PaymentDeps, 'now' | 'registry'>,
  booking: BookingRow,
  target: RescheduleTarget,
  options: { exception?: boolean; staff?: boolean } = {},
): Promise<RescheduleQuote> {
  const evaluation = await evaluateTarget(db, deps, booking, target, {
    exception: options.exception ?? false,
    staff: options.staff ?? false,
  });
  if (!evaluation.ok) {
    return {
      allowed: false,
      reason: evaluation.reason,
      message: evaluation.message,
      newQuote: null,
      settlement: null,
    };
  }
  const { settlement } = evaluation;
  return {
    allowed: true,
    reason: null,
    message: null,
    newQuote: evaluation.built.quote,
    settlement: {
      payNowCents: settlement.payNowCents,
      creditCents: settlement.creditCents,
      newTotalCents: settlement.newTotalCents,
      newBalanceCents: settlement.newBalanceCents,
    },
  };
}

// --- Moving the booking -----------------------------------------------------------------------

interface Placement {
  roomId: string;
  date: LocalDate;
  startsAt: Date;
  endsAt: Date;
  segments: QuoteSegment[];
  grossCents: number;
  discountCents: number;
  discountSource: string;
}

interface Money {
  totalCents: number;
  paidCents: number;
  depositCents: number;
  balanceCents: number;
}

const placementOf = (quote: Quote, evaluation: { startsAt: Date; endsAt: Date }): Placement => ({
  roomId: quote.roomId,
  date: quote.date,
  startsAt: evaluation.startsAt,
  endsAt: evaluation.endsAt,
  segments: quote.segments,
  grossCents: quote.grossCents,
  discountCents: quote.discount.cents,
  discountSource: quote.discount.source,
});

/** Balance charge and deadline counted from the new start; a date already past is pushed to now. */
function balanceSchedule(
  booking: BookingRow,
  mode: string,
  startsAt: Date,
  balanceCents: number,
  now: Date,
): { balanceChargeAt: Date | null; balanceDueAt: Date | null } {
  if (balanceCents <= 0 || mode !== 'deposit_balance') {
    return { balanceChargeAt: null, balanceDueAt: null };
  }
  const snapshot = snapshotOf(booking);
  const hours = (h: number) => h * 3_600_000;
  const dueAt = new Date(
    Math.max(
      startsAt.getTime() - hours(snapshot['payment.balance_deadline_hours_before']),
      now.getTime() + snapshot['payment.checkout_hold_minutes'] * 60_000,
    ),
  );
  const chargeAt = new Date(
    Math.min(
      Math.max(
        startsAt.getTime() - hours(snapshot['payment.balance_charge_hours_before']),
        now.getTime(),
      ),
      dueAt.getTime(),
    ),
  );
  return { balanceChargeAt: chargeAt, balanceDueAt: dueAt };
}

/**
 * Moves the occupancy first (a taken slot raises 409 before anything else was written), then the
 * segments and money, bumps `ics_sequence` and `reschedule_count`, and records one history row
 * (a status change when the balance flips the booking between `confirmed` and `paid`).
 */
async function relocateBooking(
  tx: Tx,
  deps: Pick<PaymentDeps, 'now' | 'env'>,
  ctx: RequestContext,
  booking: BookingRow,
  to: Placement,
  money: Money,
  eventData: Record<string, unknown>,
  fx: AfterCommit,
  options: { reactivate?: boolean } = {},
): Promise<BookingRow> {
  const now = deps.now();
  const until = new Date(to.endsAt.getTime() + booking.cleanupMinutes * 60_000);
  try {
    await tx.transaction(async (savepoint) => {
      const moved = await savepoint
        .update(roomOccupancy)
        .set({
          roomId: to.roomId,
          period: `[${to.startsAt.toISOString()},${until.toISOString()})`,
          active: true,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(roomOccupancy.kind, 'booking'),
            eq(roomOccupancy.refId, booking.id),
            // A request that held the booking's own slot parked its occupancy (`holdsOwnSlot`).
            options.reactivate === true ? undefined : eq(roomOccupancy.active, true),
          ),
        )
        .returning({ id: roomOccupancy.id });
      if (moved.length === 0) {
        throw new AppError(409, 'INVALID_STATE', 'A reserva não ocupa mais o horário.');
      }
    });
  } catch (error) {
    if (sqlStateOf(error) === '23P01') throw slotTaken();
    throw error;
  }

  await tx.delete(bookingSegments).where(eq(bookingSegments.bookingId, booking.id));
  await tx.insert(bookingSegments).values(
    to.segments.map((segment, index) => ({
      bookingId: booking.id,
      seq: index + 1,
      startsAt: localToUtc(to.date, segment.startMinute),
      endsAt: localToUtc(to.date, segment.endMinute),
      categoryId: segment.categoryId,
      categoryName: segment.categoryName,
      dayType: segment.dayType,
      rateCentsPerHour: segment.rateCentsPerHour,
      minutes: segment.minutes,
      amountCents: segment.amountCents,
    })),
  );

  const mode =
    booking.paymentMode === 'full_upfront' && money.balanceCents > 0
      ? 'deposit_balance'
      : booking.paymentMode;
  const [updated] = await tx
    .update(bookings)
    .set({
      roomId: to.roomId,
      startsAt: to.startsAt,
      endsAt: to.endsAt,
      durationMinutes: Math.round((to.endsAt.getTime() - to.startsAt.getTime()) / 60_000),
      paymentMode: mode,
      grossCents: to.grossCents,
      discountCents: to.discountCents,
      discountSource: to.discountSource,
      totalCents: money.totalCents,
      depositCents: money.depositCents,
      paidCents: money.paidCents,
      balanceCents: money.balanceCents,
      ...balanceSchedule(booking, mode, to.startsAt, money.balanceCents, now),
      rescheduleCount: booking.rescheduleCount + 1,
      icsSequence: booking.icsSequence + 1,
      updatedAt: sql`now()`,
    })
    .where(eq(bookings.id, booking.id))
    .returning();
  if (updated === undefined) throw notFound();

  const moneyMode = mode === 'deposit_balance' || mode === 'full_upfront';
  const nextStatus =
    booking.status === 'paid' && money.balanceCents > 0
      ? 'confirmed'
      : booking.status === 'confirmed' &&
          money.balanceCents === 0 &&
          moneyMode &&
          money.paidCents > 0
        ? 'paid'
        : booking.status;
  const data = {
    from: { roomId: booking.roomId, startsAt: booking.startsAt, endsAt: booking.endsAt },
    to: { roomId: to.roomId, startsAt: to.startsAt, endsAt: to.endsAt },
    totalCents: { from: booking.totalCents, to: money.totalCents },
    ...eventData,
  };
  let result = updated;
  if (nextStatus !== booking.status) {
    result = await transitionBooking(
      tx,
      ctx,
      booking.id,
      [booking.status as 'confirmed' | 'paid'],
      nextStatus as 'confirmed' | 'paid',
      'rescheduled',
      data,
    );
  } else {
    await tx.insert(bookingEvents).values({
      bookingId: booking.id,
      fromStatus: booking.status,
      toStatus: booking.status,
      actorUserId: ctx.actorUserId,
      origin: ctx.origin,
      reason: 'rescheduled',
      data,
    });
  }
  const mail = await loadBookingMailContext(tx, result, deps.env);
  fx.emailIds.push(await bookingMailer.rescheduled(tx, result, mail));
  return result;
}

// --- Reschedule requests (difference paid before moving) ---------------------------------------

/** Frees the system block that holds the target slot of a request. */
async function releaseHoldBlock(tx: Tx, blockId: string | null): Promise<void> {
  if (blockId === null) return;
  await tx
    .update(blocks)
    .set({ cancelledAt: sql`now()` })
    .where(and(eq(blocks.id, blockId), sql`${blocks.cancelledAt} is null`));
  await tx
    .update(roomOccupancy)
    .set({ active: false, updatedAt: sql`now()` })
    .where(
      and(
        eq(roomOccupancy.kind, 'block'),
        eq(roomOccupancy.refId, blockId),
        eq(roomOccupancy.active, true),
      ),
    );
}

/**
 * Parks or restores the booking's own occupancy around a request whose target overlaps it in the
 * same room. While the difference is pending, the hold block covers the union of the current and
 * the target slot (one contiguous range, cleanup included), and the booking's own row is inactive
 * so the exclusion constraint does not see the slot twice. Restoring puts the row back on the
 * booking's current `[start, end + cleanup)`, and only for a booking that still occupies a slot.
 */
async function parkOwnOccupancy(tx: Tx, bookingId: string): Promise<void> {
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

async function restoreOwnOccupancy(tx: Tx, bookingId: string): Promise<void> {
  await tx.execute(sql`
    update room_occupancy o
       set active = true,
           room_id = b.room_id,
           period = tstzrange(b.starts_at, b.ends_at + b.cleanup_minutes * interval '1 minute', '[)'),
           updated_at = now()
      from bookings b
     where b.id = ${bookingId}::uuid
       and o.kind = 'booking' and o.ref_id = b.id and not o.active
       and b.status in ('confirmed', 'paid')`);
}

const holdsOwnSlot = (request: RescheduleRequestRow) =>
  (request.quote as Partial<StoredQuote> | null)?.holdsOwnSlot === true;

/**
 * Ends a pending request without moving the booking (NUC-147): the hold block is released and,
 * unless the caller says the charge is already settled, the pending charge is cancelled (the
 * provider is told after commit).
 */
export async function closeRescheduleRequest(
  tx: Tx,
  ctx: RequestContext,
  request: RescheduleRequestRow,
  status: 'cancelled' | 'expired',
  fx: AfterCommit,
  options: { cancelCharge?: boolean } = {},
): Promise<boolean> {
  const [closed] = await tx
    .update(bookingRescheduleRequests)
    .set({ status })
    .where(
      and(
        eq(bookingRescheduleRequests.id, request.id),
        eq(bookingRescheduleRequests.status, 'pending'),
      ),
    )
    .returning({ id: bookingRescheduleRequests.id });
  if (closed === undefined) return false;
  await releaseHoldBlock(tx, request.holdBlockId);
  if (holdsOwnSlot(request)) await restoreOwnOccupancy(tx, request.bookingId);
  if (request.chargeId !== null && options.cancelCharge !== false) {
    const cancelled = await cancelCharge(tx, ctx, request.chargeId);
    if (cancelled !== null) fx.cancelCharges.push(cancelled);
  }
  return true;
}

interface StoredQuote {
  date: LocalDate;
  startMinute: number;
  endMinute: number;
  roomId: string;
  grossCents: number;
  discountCents: number;
  discountSource: string;
  netCents: number;
  segments: QuoteSegment[];
  /** The hold block also covers the booking's own (parked) slot: the target overlaps it. */
  holdsOwnSlot?: boolean;
}

/**
 * The payment hook (`rescheduleRequestHook`): `approved` moves the booking to the held slot with
 * the difference paid, or, when the slot is no longer free or the booking is no longer movable,
 * refunds the difference and mails the customer; `failed` releases the hold (NUC-146, NUC-147).
 */
export async function applyRescheduleRequest(
  tx: Tx,
  ctx: RequestContext,
  request: RescheduleRequestRow,
  outcome: RescheduleCharge,
  deps: PaymentDeps,
): Promise<RescheduleApplyEffects> {
  const fx = newAfterCommit();
  if (outcome === 'failed') {
    await closeRescheduleRequest(tx, ctx, request, 'cancelled', fx, { cancelCharge: false });
    return { emailIds: fx.emailIds, refundIds: fx.refundIds };
  }

  const [booking] = await tx
    .select()
    .from(bookings)
    .where(eq(bookings.id, request.bookingId))
    .for('update');
  if (booking === undefined || request.chargeId === null) throw notFound();
  const [charge] = await tx.select().from(charges).where(eq(charges.id, request.chargeId));
  if (charge === undefined) throw notFound();
  await releaseHoldBlock(tx, request.holdBlockId);

  const stored = request.quote as StoredQuote;
  let moved: BookingRow | null = null;
  if (booking.status === 'confirmed' || booking.status === 'paid') {
    const paidCents = booking.paidCents + charge.amountCents;
    const balanceCents = Math.max(0, stored.netCents - paidCents);
    try {
      moved = await relocateBooking(
        tx,
        deps,
        ctx,
        booking,
        {
          roomId: request.newRoomId,
          date: stored.date,
          startsAt: request.newStartsAt,
          endsAt: request.newEndsAt,
          segments: stored.segments,
          grossCents: stored.grossCents,
          discountCents: stored.discountCents,
          discountSource: stored.discountSource,
        },
        {
          totalCents: stored.netCents,
          paidCents,
          depositCents: Math.min(booking.depositCents, stored.netCents),
          balanceCents,
        },
        {
          rescheduleRequestId: request.id,
          chargeId: charge.id,
          differenceCents: charge.amountCents,
        },
        fx,
        { reactivate: stored.holdsOwnSlot === true },
      );
    } catch (error) {
      if (!(error instanceof AppError) || error.code !== 'SLOT_TAKEN') throw error;
    }
  }
  if (moved === null && stored.holdsOwnSlot === true) {
    await restoreOwnOccupancy(tx, booking.id);
  }

  if (moved !== null) {
    await tx
      .update(bookingRescheduleRequests)
      .set({ status: 'applied', appliedAt: deps.now() })
      .where(eq(bookingRescheduleRequests.id, request.id));
    return { emailIds: fx.emailIds, refundIds: fx.refundIds };
  }

  // The slot is gone (or the booking is no longer movable): the difference goes back (NUC-147).
  const refund = await requestRefund(tx, {
    chargeId: charge.id,
    amountCents: charge.amountCents,
    reason: 'late_approval_conflict',
    ctx,
  });
  fx.refundIds.push(refund.id);
  await tx
    .update(bookingRescheduleRequests)
    .set({ status: 'refunded' })
    .where(eq(bookingRescheduleRequests.id, request.id));
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
    action: 'booking.reschedule_refund',
    entityType: 'booking',
    entityId: booking.id,
    after: { requestId: request.id, chargeId: charge.id, refundId: refund.id },
  });
  return { emailIds: fx.emailIds, refundIds: fx.refundIds };
}

// --- Entry point --------------------------------------------------------------------------------

export interface RescheduleInput {
  bookingId: string;
  /** Tenants may only move their own booking; admins may move any. */
  actor: { kind: 'tenant'; userId: string } | { kind: 'admin' };
  target: RescheduleTarget;
  method?: PayMethod | undefined;
  savedCardId?: string | undefined;
  exception?: boolean | undefined;
  differenceHandling?: 'add_to_balance' | 'waive' | undefined;
  justification?: string | undefined;
}

export type RescheduleOutcome =
  | { kind: 'moved'; booking: BookingRow; creditCents: number }
  | { kind: 'payment_required'; request: RescheduleRequestRow; charge: ChargeRow };

async function lockBooking(tx: Tx, input: RescheduleInput): Promise<BookingRow> {
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
  return booking;
}

const needsDifferenceChoice = () =>
  validationFailed([{ path: ['differenceHandling'], message: 'Informe como tratar a diferença' }]);

/**
 * Reschedules a booking (NUC-142..NUC-149). A cheaper or equal slot moves at once and turns the
 * surplus into credit; a more expensive one holds the slot with a system block, creates the
 * `booking_difference` charge and waits for its approval (the tenant) or applies the admin's
 * choice (`add_to_balance` / `waive`). All checks run again inside the transaction, behind the
 * advisory locks of both dates.
 */
export async function rescheduleBooking(
  deps: PaymentDeps,
  ctx: RequestContext,
  input: RescheduleInput,
): Promise<RescheduleOutcome> {
  const { db, registry } = deps;
  const tenant = input.actor.kind === 'tenant';
  const options = { exception: input.exception === true, staff: !tenant };

  const fx = newAfterCommit();
  const outcome = await db.transaction(async (tx): Promise<RescheduleOutcome> => {
    const locked = await lockBooking(tx, input);
    await lockCalendarDates(tx, [utcToLocal(locked.startsAt).date, input.target.date]);
    const now = deps.now();

    const [pending] = await tx
      .select()
      .from(bookingRescheduleRequests)
      .where(
        and(
          eq(bookingRescheduleRequests.bookingId, locked.id),
          eq(bookingRescheduleRequests.status, 'pending'),
        ),
      );
    // A new attempt replaces a payment the customer never finished.
    if (pending !== undefined) await closeRescheduleRequest(tx, ctx, pending, 'cancelled', fx);

    const evaluation = await evaluateTarget(tx, deps, locked, input.target, options);
    if (!evaluation.ok) throw evaluation.error;
    const { built } = evaluation;
    const quote = built.quote;
    let settlement = evaluation.settlement;
    const handler = handlerFor(registry, locked.paymentMode as PaymentMode);
    if (handler?.reschedule !== undefined) {
      const minutes = await handler.reschedule(tx, locked, built.draft, now);
      settlement = { ...settlement, payNowCents: minutes.payNowCents, creditCents: 0 };
    }
    const to = placementOf(quote, evaluation);

    if (settlement.payNowCents > 0 && tenant) {
      // Nothing is written until payment can start: no method or no gateway fails the request.
      if (input.method === undefined) {
        throw validationFailed([{ path: ['method'], message: 'Escolha a forma de pagamento' }]);
      }
      if (input.method !== 'saved_card') await resolveGatewayForCharge({ ...deps, db: tx });
      const expiresAt = new Date(now.getTime() + quote.holdMinutes * 60_000);
      const cleanupMs = locked.cleanupMinutes * 60_000;
      const ownUntil = new Date(locked.endsAt.getTime() + cleanupMs);
      const targetUntil = new Date(evaluation.endsAt.getTime() + cleanupMs);
      // A target overlapping the booking's own slot (same room) is held together with it.
      const overlapsOwn =
        quote.roomId === locked.roomId &&
        evaluation.startsAt < ownUntil &&
        locked.startsAt < targetUntil;
      if (overlapsOwn) await parkOwnOccupancy(tx, locked.id);
      const block = await createHoldBlock(tx, {
        roomId: quote.roomId,
        startsAt: overlapsOwn
          ? new Date(Math.min(locked.startsAt.getTime(), evaluation.startsAt.getTime()))
          : evaluation.startsAt,
        endsAt: overlapsOwn
          ? new Date(Math.max(ownUntil.getTime(), targetUntil.getTime()))
          : targetUntil,
        tag: HOLD_TAG,
        createdBy: ctx.actorUserId,
      });
      const charge = await createCharge(tx, ctx, {
        purpose: 'booking_difference',
        userId: locked.userId,
        bookingId: locked.id,
        amountCents: settlement.payNowCents,
        method: input.method ?? 'pix',
        ...(input.savedCardId !== undefined && { savedCardId: input.savedCardId }),
        expiresAt,
      });
      const stored: StoredQuote = {
        date: quote.date,
        startMinute: quote.startMinute,
        endMinute: quote.endMinute,
        roomId: quote.roomId,
        grossCents: quote.grossCents,
        discountCents: quote.discount.cents,
        discountSource: quote.discount.source,
        netCents: quote.netCents,
        segments: quote.segments,
        ...(overlapsOwn && { holdsOwnSlot: true }),
      };
      const [request] = await tx
        .insert(bookingRescheduleRequests)
        .values({
          bookingId: locked.id,
          userId: locked.userId,
          newRoomId: quote.roomId,
          newStartsAt: evaluation.startsAt,
          newEndsAt: evaluation.endsAt,
          quote: stored,
          payNowCents: settlement.payNowCents,
          chargeId: charge.id,
          holdBlockId: block.id,
          expiresAt,
        })
        .returning();
      if (request === undefined)
        throw new Error('rescheduleBooking: request insert returned no row');
      await audit(tx, ctx, {
        action: 'booking.reschedule_requested',
        entityType: 'booking',
        entityId: locked.id,
        after: { requestId: request.id, payNowCents: settlement.payNowCents },
      });
      return { kind: 'payment_required', request, charge };
    }

    // The move happens now: credit for a cheaper slot, or the admin's choice for a dearer one.
    let money: Money = {
      totalCents: settlement.newTotalCents,
      paidCents: settlement.newPaidCents,
      depositCents: settlement.newDepositCents,
      balanceCents: settlement.newBalanceCents,
    };
    const eventData: Record<string, unknown> = {};
    let placement = to;
    if (settlement.payNowCents > 0) {
      if (input.differenceHandling === undefined) throw needsDifferenceChoice();
      if (input.differenceHandling === 'add_to_balance') {
        money = {
          totalCents: quote.netCents,
          paidCents: locked.paidCents,
          depositCents: Math.min(locked.depositCents, quote.netCents),
          balanceCents: Math.max(0, quote.netCents - locked.paidCents),
        };
      } else {
        // Waived: the customer keeps the old price; the difference is booked as a discount.
        money = {
          totalCents: locked.totalCents,
          paidCents: locked.paidCents,
          depositCents: locked.depositCents,
          balanceCents: locked.balanceCents,
        };
        placement = { ...to, discountCents: to.discountCents + settlement.payNowCents };
      }
      eventData['differenceHandling'] = input.differenceHandling;
      eventData['differenceCents'] = settlement.payNowCents;
    }
    if (input.exception === true) eventData['exception'] = true;

    if (settlement.creditCents > 0) {
      const grant = await registry.credits.grant(tx, {
        userId: locked.userId,
        amountCents: settlement.creditCents,
        source: 'reschedule_difference',
        refType: 'booking',
        refId: locked.id,
        ctx,
        now,
      });
      eventData['creditGrant'] =
        registry.credits.mode === 'deferred'
          ? { amountCents: settlement.creditCents, status: 'deferred' }
          : {
              amountCents: settlement.creditCents,
              status: 'granted',
              creditLotId: grant.creditLotId,
            };
    }

    const moved = await relocateBooking(tx, deps, ctx, locked, placement, money, eventData, fx);
    await audit(tx, ctx, {
      action: input.exception === true ? 'booking.reschedule_exception' : 'booking.reschedule',
      entityType: 'booking',
      entityId: locked.id,
      ...(input.justification !== undefined && { justification: input.justification }),
      before: { startsAt: locked.startsAt, endsAt: locked.endsAt, roomId: locked.roomId },
      after: { startsAt: moved.startsAt, endsAt: moved.endsAt, roomId: moved.roomId },
    });
    if (input.differenceHandling === 'waive' && settlement.payNowCents > 0) {
      await audit(tx, ctx, {
        action: 'booking.difference_waived',
        entityType: 'booking',
        entityId: locked.id,
        ...(input.justification !== undefined && { justification: input.justification }),
        after: { differenceCents: settlement.payNowCents },
      });
    }
    return { kind: 'moved', booking: moved, creditCents: settlement.creditCents };
  });
  await flushAfterCommit(deps, fx, ctx);

  if (outcome.kind === 'moved') return outcome;
  try {
    const charge = await submitCharge(deps, outcome.charge.id);
    return { ...outcome, charge };
  } catch (error) {
    // The customer was never offered a way to pay: do not leave the slot held.
    const undo = newAfterCommit();
    await db.transaction(async (tx) => {
      const [request] = await tx
        .select()
        .from(bookingRescheduleRequests)
        .where(eq(bookingRescheduleRequests.id, outcome.request.id))
        .for('update');
      if (request !== undefined) await closeRescheduleRequest(tx, ctx, request, 'cancelled', undo);
    });
    await flushAfterCommit(deps, undo, ctx);
    throw error;
  }
}
