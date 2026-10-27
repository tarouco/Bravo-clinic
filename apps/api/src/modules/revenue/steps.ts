import {
  allocateRefund,
  chooseDiscount,
  discountNote,
  localToUtc,
  slotDiscountCents,
  type CouponRejectionReason,
  type PackageOption,
} from '@bravo/core';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Tx } from '../../db/client';
import { bookingEvents, bookings, charges } from '../../db/schema';
import type { BookingRow, CheckoutStep, QuoteContext, QuoteDraft } from '../../extensions/registry';
import type { AuditOrigin, RequestContext } from '../../lib/audit';
import { AppError } from '../../lib/errors';
import {
  consumeUse,
  couponInvalid,
  evaluateCoupon,
  releaseUse,
  reserveUse,
} from '../coupons/coupons.service';
import { applyCredits, refundCredit } from '../credits/credits.service';
import {
  debitForBooking,
  quotePackageOption,
  type PackageDraft,
} from '../packages/package-payment.service';
import { consumeForBooking, discountMinutes } from '../slot-discounts/slot-discounts.service';

// Receita's checkout steps in nucleo's pipeline (design.md "Required from nucleo" A, AD-031):
// discount (100), package (200) and credit (400). `apply` is pure; `persist`, `onConfirmed` and
// `release` run inside nucleo's booking transaction. Each step writes its public part to
// `draft.extensions.<name>`, which the web parses with `revenueQuoteSchema`.

export interface DiscountExtension {
  source: 'none' | 'coupon' | 'slot_discount';
  discountCents: number;
  slotDiscountCents: number;
  couponDiscountCents: number;
  couponId?: string;
  slotDiscountIds: string[];
  couponRejection?: { reason: CouponRejectionReason; message: string };
  note?: string;
}

interface DiscountRef {
  couponId: string | null;
  couponCents: number;
  slotDiscountIds: string[];
}

/** The audit context of a step: the booking's creator, from its channel. */
export function bookingContext(booking: BookingRow): RequestContext {
  return {
    actorUserId: booking.createdByUserId ?? booking.userId,
    actorRole: null,
    origin: booking.source as AuditOrigin,
    ip: null,
    requestId: null,
  };
}

const payingWithPackage = (ctx: QuoteContext) => ctx.request.payWith === 'package';

/** Coupon vs slot discount, larger wins (REC-116..REC-122, REC-136); none on package payment. */
export const discountStep: CheckoutStep = {
  name: 'discount',
  order: 100,

  async apply(ctx, draft) {
    const none: DiscountExtension = {
      source: 'none',
      discountCents: 0,
      slotDiscountCents: 0,
      couponDiscountCents: 0,
      slotDiscountIds: [],
    };
    if (payingWithPackage(ctx)) {
      return { ...draft, extensions: { ...draft.extensions, discount: none } };
    }

    // Slot discounts apply to hourly segments only, never to a block price.
    const hourly = draft.segments.every((s) => s.rateCentsPerHour !== null);
    const parts = hourly
      ? await discountMinutes(ctx.db, { roomId: ctx.room.id, date: ctx.date, now: ctx.now })
      : [];
    const overlapping = parts.filter(
      (p) => p.startMinute < ctx.endMinute && ctx.startMinute < p.endMinute,
    );
    const slotCents = hourly
      ? slotDiscountCents(
          draft.segments.map((s) => ({
            ...s,
            categoryId: s.categoryId ?? '',
            rateCentsPerHour: s.rateCentsPerHour ?? 0,
          })),
          overlapping,
        )
      : 0;

    let couponCents = 0;
    let couponId: string | null = null;
    let couponCode: string | null = null;
    let rejection: DiscountExtension['couponRejection'];
    const code = ctx.request.couponCode;
    if (code !== undefined) {
      const evaluation = await evaluateCoupon(ctx.db, {
        code,
        userId: ctx.user?.id ?? null,
        target: 'booking',
        grossCents: draft.grossCents,
        now: ctx.now,
      });
      if (evaluation.ok) {
        couponCents = evaluation.discountCents;
        couponId = evaluation.coupon.id;
        couponCode = evaluation.coupon.code;
      } else {
        rejection = { reason: evaluation.reason, message: evaluation.message };
      }
    }

    const choice = chooseDiscount({ grossCents: draft.grossCents, slotCents, couponCents });
    const note = discountNote({ source: choice.source, slotCents, couponCents });
    const slotDiscountIds = overlapping.map((p) => p.id);
    const extension: DiscountExtension = {
      source: choice.source,
      discountCents: choice.discountCents,
      slotDiscountCents: slotCents,
      couponDiscountCents: couponCents,
      ...(couponId !== null && { couponId }),
      slotDiscountIds,
      ...(rejection !== undefined && { couponRejection: rejection }),
      ...(note !== null && { note }),
    };
    const ref: DiscountRef = {
      couponId: choice.source === 'coupon' ? couponId : null,
      couponCents,
      slotDiscountIds,
    };
    return {
      ...draft,
      discount: {
        source: choice.source,
        cents: choice.discountCents,
        label:
          choice.source === 'coupon'
            ? `Cupom ${couponCode ?? ''}`.trim()
            : choice.source === 'slot_discount'
              ? 'Desconto do horário'
              : null,
        ref,
      },
      notices: note === null ? draft.notices : [...draft.notices, note],
      extensions: { ...draft.extensions, discount: extension },
    };
  },

  /** A rejected code fails the checkout; the winning coupon's use is reserved (REC-123, REC-124). */
  async persist(tx, booking, draft, ctx) {
    const extension = draft.extensions['discount'] as DiscountExtension | undefined;
    if (extension?.couponRejection !== undefined)
      throw couponInvalid(extension.couponRejection.reason);
    const ref = draft.discount.ref as DiscountRef | undefined;
    if (draft.discount.source !== 'coupon' || ref?.couponId == null) return;
    await reserveUse(tx, {
      couponId: ref.couponId,
      userId: booking.userId,
      discountCents: draft.discount.cents,
      bookingId: booking.id,
      now: ctx.now,
    });
    await tx.update(bookings).set({ couponId: ref.couponId }).where(eq(bookings.id, booking.id));
  },

  /** Confirmation consumes the coupon use and the overlapped slot-discount part (REC-124, REC-138). */
  async onConfirmed(tx, booking, now) {
    await consumeUse(tx, { bookingId: booking.id }, now);
    await consumeForBooking(tx, booking, now);
  },

  /** Expiry or cancellation before approval gives the use back (REC-124). */
  async release(tx, booking, _reason, _result, now) {
    await releaseUse(tx, { bookingId: booking.id }, now);
  },
};

/** What the package mode handler needs to re-debit on reschedule. */
interface PackageDebitDetail {
  date: string;
  startsAt: string;
}

/** "Pagar com meu pacote" (REC-23..REC-33): option in the quote, debit at creation. */
export const packageStep: CheckoutStep = {
  name: 'package',
  order: 200,

  async apply(ctx, draft) {
    let option: PackageOption | null = null;
    if (ctx.user !== null) {
      const startsAt = localToUtc(ctx.date, ctx.startMinute);
      const quote = await quotePackageOption(
        ctx.db,
        ctx.user.id,
        { date: ctx.date, startsAt, segments: draft.segments },
        ctx.now,
      );
      option = quote.option;
    }
    const next: QuoteDraft = { ...draft, extensions: { ...draft.extensions, package: option } };
    const detail: PackageDebitDetail = {
      date: ctx.date,
      startsAt: localToUtc(ctx.date, ctx.startMinute).toISOString(),
    };
    if (option !== null) next.packageDebit = { minutes: option.debitMinutes, detail };
    if (payingWithPackage(ctx)) {
      next.paymentMode = 'package';
      next.packageDebit = { minutes: option?.debitMinutes ?? 0, detail };
    }
    return next;
  },

  /** Debits the minutes in nucleo's transaction; a short balance aborts the booking (REC-27, REC-29). */
  async persist(tx, booking, draft, ctx) {
    if (draft.paymentMode !== 'package') return;
    await debitForBooking(tx, bookingContext(booking), {
      bookingId: booking.id,
      userId: booking.userId,
      draft: { date: ctx.date, startsAt: booking.startsAt, segments: draft.segments },
      now: ctx.now,
    });
    await tx
      .update(bookings)
      .set({
        totalCents: 0,
        balanceCents: 0,
        depositCents: 0,
        discountCents: 0,
        discountSource: 'none',
      })
      .where(eq(bookings.id, booking.id));
  },
};

/** The `PackageDraft` of a rescheduled package booking, from the package step's detail. */
export function packageDraftOf(draft: QuoteDraft): PackageDraft | null {
  const detail = draft.packageDebit?.detail as PackageDebitDetail | undefined;
  if (detail === undefined) return null;
  return {
    date: detail.date as PackageDraft['date'],
    startsAt: new Date(detail.startsAt),
    segments: draft.segments,
  };
}

/** Approved internal credit charges of a booking with what is still not refunded. */
async function creditChargesOf(tx: Tx, bookingId: string) {
  const rows = await tx
    .select()
    .from(charges)
    .where(
      and(
        eq(charges.bookingId, bookingId),
        eq(charges.method, 'credit'),
        inArray(charges.status, ['approved', 'partially_refunded']),
      ),
    )
    .orderBy(desc(charges.createdAt));
  return rows.map((charge) => ({ charge, open: charge.amountCents - charge.refundedCents }));
}

/** The clinic's choice recorded on the cancellation event (nucleo writes it before `release`). */
async function clinicResolution(tx: Tx, bookingId: string): Promise<unknown> {
  const [event] = await tx
    .select({ data: bookingEvents.data })
    .from(bookingEvents)
    .where(eq(bookingEvents.bookingId, bookingId))
    .orderBy(desc(bookingEvents.id))
    .limit(1);
  return (event?.data as { resolution?: unknown } | null)?.resolution;
}

/** Credits as total or partial payment (REC-107..REC-109, REC-115). */
export const creditStep: CheckoutStep = {
  name: 'credit',
  order: 400,

  apply(ctx, draft) {
    const extras = draft.extras.reduce((sum, e) => sum + e.amountCents, 0);
    const net = Math.max(0, draft.grossCents - draft.discount.cents + extras);
    const applied =
      ctx.request.useCredits === true && draft.paymentMode !== 'package'
        ? Math.min(draft.creditAvailableCents, net)
        : 0;
    return Promise.resolve({
      ...draft,
      extensions: {
        ...draft.extensions,
        credit: { availableCents: draft.creditAvailableCents, appliedCents: applied },
      },
    });
  },

  /** The credit nucleo counted as paid becomes one internal charge (AD-027). */
  async persist(tx, booking, _draft, ctx) {
    if (booking.creditAppliedCents <= 0) return;
    const used = await applyCredits(tx, bookingContext(booking), {
      userId: booking.userId,
      amountCents: booking.creditAppliedCents,
      purpose: booking.paymentMode === 'full_upfront' ? 'booking_full' : 'booking_deposit',
      bookingId: booking.id,
      now: ctx.now,
    });
    if (used.usedCents !== booking.creditAppliedCents) {
      throw new AppError(409, 'CONFLICT', 'Seu saldo de créditos mudou. Revise o resumo.');
    }
  },

  /**
   * Expiry returns all applied credit; a cancellation returns the credit share of the refund
   * (`allocateRefund`: the retained amount consumes credit first). A clinic cancellation resolved
   * as credit already granted the whole paid amount, so nothing more comes back.
   */
  async release(tx, booking, reason, result, now) {
    const open = await creditChargesOf(tx, booking.id);
    const creditPaid = open.reduce((sum, c) => sum + c.open, 0);
    if (creditPaid <= 0) return;
    let back = creditPaid;
    if (reason === 'cancelled') {
      if (result === undefined) return;
      if ((await clinicResolution(tx, booking.id)) === 'credit') return;
      const paid = Math.max(booking.paidCents, creditPaid);
      back = allocateRefund({
        cashPaidCents: paid - creditPaid,
        creditPaidCents: creditPaid,
        refundCents: Math.min(result.refundCents, paid),
      }).creditRefundCents;
    }
    const ctx = bookingContext(booking);
    for (const { charge, open: left } of open) {
      if (back <= 0) break;
      const amount = Math.min(back, left);
      await refundCredit(tx, ctx, { chargeId: charge.id, amountCents: amount, now });
      back -= amount;
    }
  },
};
