import { basisPointsOfCents, formatBRL, mulDivRoundHalfUp, type Cents } from '../money';
import type { PricedSegment } from './price';
import type { CouponRejectionReason } from '../validation/revenue-schemas';

// Coupon vs slot discount (docs/architecture.md section 7.7, PRD 5.3.3, 5.3.4).

/** Percent in basis points (1000 = 10%); fixed in cents. */
export interface CouponTerms {
  kind: 'percent' | 'fixed';
  value: number;
}

/** The coupon fields validation needs (`coupons` row). */
export interface CouponRow {
  type: 'first_booking' | 'discount';
  discountKind: 'percent' | 'fixed';
  discountValue: number;
  appliesTo: 'bookings' | 'packages' | 'both';
  maxUses: number | null;
  usesCount: number;
  perCustomerLimit: number | null;
  validFrom: Date | null;
  validUntil: Date | null;
  enabled: boolean;
}

/** Coupon discount on a gross amount; a fixed discount is capped at the gross (REC-116). */
export function couponDiscountCents(grossCents: Cents, coupon: CouponTerms): Cents {
  if (coupon.kind === 'percent') return basisPointsOfCents(grossCents, coupon.value);
  return Math.min(coupon.value, grossCents);
}

/**
 * Slot discount of an hourly booking (REC-142): for each segment and each discount, the overlapped
 * minutes cost `mulDivRoundHalfUp(rate × minutes, percent, 6000)`; the parts are summed.
 */
export function slotDiscountCents(
  segments: PricedSegment[],
  discounts: { startMinute: number; endMinute: number; percent: number }[],
): Cents {
  let total = 0;
  for (const segment of segments) {
    for (const discount of discounts) {
      const minutes =
        Math.min(segment.endMinute, discount.endMinute) -
        Math.max(segment.startMinute, discount.startMinute);
      if (minutes <= 0) continue;
      total += mulDivRoundHalfUp(segment.rateCentsPerHour * minutes, discount.percent, 6000);
    }
  }
  return total;
}

/**
 * The larger discount wins; a tie keeps the slot discount, so the coupon use is not reserved
 * (REC-120). No discount at all → `none`.
 */
export function chooseDiscount(args: { grossCents: Cents; slotCents: Cents; couponCents: Cents }): {
  source: 'none' | 'coupon' | 'slot_discount';
  discountCents: Cents;
  netCents: Cents;
} {
  const { grossCents, slotCents, couponCents } = args;
  if (slotCents <= 0 && couponCents <= 0) {
    return { source: 'none', discountCents: 0, netCents: grossCents };
  }
  const source = couponCents > slotCents ? 'coupon' : 'slot_discount';
  const discountCents = Math.min(source === 'coupon' ? couponCents : slotCents, grossCents);
  return { source, discountCents, netCents: grossCents - discountCents };
}

/**
 * Coupon eligibility (REC-117..REC-119, REC-126). Validity is the half-open range
 * `[validFrom, validUntil)`. `customerPriorUses` = reserved + consumed uses by the same document
 * (else user); `docHasPriorBooking` = the document has a booking that reached `confirmed` or a
 * reserved/consumed first-booking use.
 */
export function validateCoupon(args: {
  coupon: CouponRow | null;
  now: Date;
  target: 'booking' | 'package';
  customerPriorUses: number;
  docHasPriorBooking: boolean;
}): { ok: true } | { ok: false; reason: CouponRejectionReason } {
  const { coupon, now } = args;
  const fail = (reason: CouponRejectionReason) => ({ ok: false as const, reason });
  if (coupon === null) return fail('not_found');
  if (!coupon.enabled) return fail('disabled');
  if (coupon.validFrom !== null && now.getTime() < coupon.validFrom.getTime()) {
    return fail('not_yet_valid');
  }
  if (coupon.validUntil !== null && now.getTime() >= coupon.validUntil.getTime()) {
    return fail('expired');
  }
  const applies =
    coupon.appliesTo === 'both' ||
    (args.target === 'booking' ? coupon.appliesTo === 'bookings' : coupon.appliesTo === 'packages');
  if (!applies) return fail('not_applicable');
  if (coupon.maxUses !== null && coupon.usesCount >= coupon.maxUses) return fail('exhausted');
  if (coupon.type === 'first_booking' && args.docHasPriorBooking) return fail('first_booking_only');
  if (coupon.perCustomerLimit !== null && args.customerPriorUses >= coupon.perCustomerLimit) {
    return fail('customer_limit');
  }
  return { ok: true };
}

const REJECT_MESSAGES: Record<CouponRejectionReason, string> = {
  not_found: 'Cupom inexistente',
  disabled: 'Cupom desabilitado',
  exhausted: 'Cupom esgotado',
  expired: 'Cupom expirado',
  not_yet_valid: 'Cupom ainda não está válido',
  first_booking_only: 'Válido só na primeira reserva',
  not_applicable: 'Cupom não se aplica a esta compra',
  customer_limit: 'Você já usou este cupom o número máximo de vezes',
};

/** pt-BR message of a coupon rejection (REC-117). */
export function couponRejectMessage(reason: CouponRejectionReason): string {
  return REJECT_MESSAGES[reason];
}

/**
 * Note shown when a coupon and a slot discount both applied (REC-121); null when only one (or
 * none) applied.
 */
export function discountNote(choice: {
  source: 'none' | 'coupon' | 'slot_discount';
  slotCents: Cents;
  couponCents: Cents;
}): string | null {
  if (choice.slotCents <= 0 || choice.couponCents <= 0) return null;
  if (choice.source === 'coupon') {
    return `Aplicamos o maior desconto: cupom ${formatBRL(choice.couponCents)} (o desconto do horário era ${formatBRL(choice.slotCents)}).`;
  }
  if (choice.source === 'slot_discount') {
    return `Aplicamos o maior desconto: desconto do horário ${formatBRL(choice.slotCents)} (o cupom era ${formatBRL(choice.couponCents)}).`;
  }
  return null;
}
