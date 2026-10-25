import type { z } from 'zod';
import { mulDivRoundHalfUp, type Cents } from '../money';
import { diffDays, addDays, utcToLocal, type LocalDate } from '../time';
import type { chargePurposeSchema } from '../contracts/common';
import { CANCELLED_STATUSES } from '../status/booking';
import type { financeRegimeSchema, REVENUE_CATEGORIES } from '../validation/gestao-schemas';

// Revenue recognition in Caixa and Competência (AD-027, spec GES-01..GES-10). Pure: the API
// loads the facts of a range and the browser can recompute the same entries.

export type Regime = z.infer<typeof financeRegimeSchema>;
export type RevenueCategory = (typeof REVENUE_CATEGORIES)[number];
type ChargePurpose = z.infer<typeof chargePurposeSchema>;

export interface ChargeFact {
  id: string;
  purpose: ChargePurpose;
  method: 'pix' | 'card' | 'saved_card' | 'credit';
  amountCents: Cents;
  feeCents: Cents;
  status: 'approved' | 'refunded' | 'partially_refunded' | 'charged_back';
  approvedAt: Date;
  chargedBackAt?: Date;
  booking?: {
    id: string;
    startsAt: Date;
    status: string;
    cancelledAt?: Date;
    paymentMode: string;
    totalCents: Cents;
    discountCents: Cents;
    extrasCents: Cents;
    firstApprovedChargeId: string;
  };
  period?: {
    id: string;
    startsOn: LocalDate;
    endsOn: LocalDate;
    discountCents: Cents;
    firstApprovedChargeId: string;
  };
}

export interface RefundFact {
  chargeId: string;
  amountCents: Cents;
  completedAt: Date;
}

export interface ManualReceiptFact {
  date: LocalDate;
  category: RevenueCategory;
  amountCents: Cents;
  booking?: { startsAt: Date };
}

export interface ExpenseFact {
  date: LocalDate;
  categoryId: string;
  amountCents: Cents;
}

/** DRE lines 1 (gross), 2 (discounts and credits), 3 (refunds), 4 (fees) and 6 (expenses). */
export type Line = 'gross' | 'discounts' | 'refunds' | 'fees' | 'expenses';

/** One dated amount; discounts, refunds, fees and expenses are negative. */
export interface Entry {
  date: LocalDate;
  line: Line;
  /** A `RevenueCategory` on lines 1..4; the expense category id on `expenses`. */
  category: string;
  cents: Cents;
}

const CATEGORY_BY_PURPOSE: Record<ChargePurpose, RevenueCategory> = {
  booking_deposit: 'rental_single',
  booking_balance: 'rental_single',
  booking_full: 'rental_single',
  booking_difference: 'rental_single',
  subscription_initial: 'subscription_initial',
  subscription_renewal: 'subscription_renewal',
  extra_hours: 'extra_hours',
  extra_service: 'extra_services',
};

/** Revenue category of a charge purpose (GES-01). */
export function chargeCategory(purpose: ChargePurpose): RevenueCategory {
  return CATEGORY_BY_PURPOSE[purpose];
}

/**
 * `cents` split evenly over the local days of `[startsOn, endsOn)`; leftover cents go one each to
 * the earliest days, so the parts always sum to `cents` (GES-04).
 */
export function spreadOverDays(
  cents: Cents,
  startsOn: LocalDate,
  endsOn: LocalDate,
): { date: LocalDate; cents: Cents }[] {
  const days = diffDays(startsOn, endsOn);
  if (days < 1) throw new Error(`Empty period ${startsOn}..${endsOn}`);
  const sign = cents < 0 ? -1 : 1;
  const abs = Math.abs(cents);
  const base = Math.floor(abs / days);
  const leftover = abs - base * days;
  return Array.from({ length: days }, (_, i) => ({
    date: addDays(startsOn, i),
    cents: sign * (base + (i < leftover ? 1 : 0)),
  }));
}

/** Share of a booking receipt that pays extras: `amount × extras / total` half up (GES-08). */
export function splitExtras(
  amountCents: Cents,
  extrasCents: Cents,
  totalCents: Cents,
): { extras: Cents; rental: Cents } {
  const extras = mulDivRoundHalfUp(amountCents, extrasCents, totalCents);
  return { extras, rental: amountCents - extras };
}

type Dating = { date: LocalDate } | { startsOn: LocalDate; endsOn: LocalDate };

const NO_REVENUE_MODES = new Set(['package', 'subscription']);
const ENDED_STATUSES = new Set<string>([...CANCELLED_STATUSES, 'expired']);

function localDate(instant: Date): LocalDate {
  return utcToLocal(instant).date;
}

/** Competência date of a booking: its start, or the cancellation date when it ended unused. */
function bookingUsageDate(booking: NonNullable<ChargeFact['booking']>): LocalDate {
  const ended = ENDED_STATUSES.has(booking.status);
  return localDate(ended ? (booking.cancelledAt ?? booking.startsAt) : booking.startsAt);
}

/** When a charge, its fee, its attached discount and its reversals are recognized. */
function chargeDating(regime: Regime, charge: ChargeFact): Dating {
  if (regime === 'accrual') {
    if (charge.booking) return { date: bookingUsageDate(charge.booking) };
    if (charge.period) return { startsOn: charge.period.startsOn, endsOn: charge.period.endsOn };
  }
  return { date: localDate(charge.approvedAt) };
}

function place(out: Entry[], dating: Dating, line: Line, category: string, cents: Cents): void {
  if (cents === 0) return;
  if ('date' in dating) {
    out.push({ date: dating.date, line, category, cents });
    return;
  }
  for (const part of spreadOverDays(cents, dating.startsOn, dating.endsOn)) {
    if (part.cents !== 0) out.push({ date: part.date, line, category, cents: part.cents });
  }
}

/** Discount (coupon/slot or period) carried by the first approved charge of its booking/period. */
function attachedDiscount(charge: ChargeFact): Cents {
  if (charge.booking?.firstApprovedChargeId === charge.id) return charge.booking.discountCents;
  if (charge.period?.firstApprovedChargeId === charge.id) return charge.period.discountCents;
  return 0;
}

/**
 * Dated DRE entries of the facts in one regime (GES-02..GES-09). Gross = cash + discounts +
 * credits used; line 2 deducts discounts and credits; line 3 refunds and chargebacks under the
 * original category; line 4 fees of non-credit charges.
 */
export function recognize(args: {
  regime: Regime;
  charges: ChargeFact[];
  refunds: RefundFact[];
  receipts: ManualReceiptFact[];
  expenses: ExpenseFact[];
}): Entry[] {
  const { regime } = args;
  const out: Entry[] = [];
  const chargesById = new Map(args.charges.map((c) => [c.id, c]));
  const refundedByCharge = new Map<string, Cents>();
  for (const refund of args.refunds) {
    refundedByCharge.set(
      refund.chargeId,
      (refundedByCharge.get(refund.chargeId) ?? 0) + refund.amountCents,
    );
  }

  for (const charge of args.charges) {
    if (charge.booking && NO_REVENUE_MODES.has(charge.booking.paymentMode)) continue;
    const category = chargeCategory(charge.purpose);
    const dating = chargeDating(regime, charge);
    const booking = charge.booking;

    if (category === 'rental_single' && booking && booking.extrasCents > 0) {
      const split = splitExtras(charge.amountCents, booking.extrasCents, booking.totalCents);
      place(out, dating, 'gross', 'rental_single', split.rental);
      place(out, dating, 'gross', 'extra_services', split.extras);
    } else {
      place(out, dating, 'gross', category, charge.amountCents);
    }

    if (charge.method === 'credit') {
      place(out, dating, 'discounts', category, -charge.amountCents);
    } else {
      place(out, dating, 'fees', category, -charge.feeCents);
    }

    const discount = attachedDiscount(charge);
    place(out, dating, 'gross', category, discount);
    place(out, dating, 'discounts', category, -discount);

    if (charge.status === 'charged_back') {
      const reversed = charge.amountCents - (refundedByCharge.get(charge.id) ?? 0);
      const at =
        regime === 'cash' ? { date: localDate(charge.chargedBackAt ?? charge.approvedAt) } : dating;
      place(out, at, 'refunds', category, -Math.max(reversed, 0));
    }
  }

  for (const refund of args.refunds) {
    const charge = chargesById.get(refund.chargeId);
    if (!charge) throw new Error(`Refund references charge ${refund.chargeId} missing from facts`);
    if (charge.booking && NO_REVENUE_MODES.has(charge.booking.paymentMode)) continue;
    const at =
      regime === 'cash' ? { date: localDate(refund.completedAt) } : chargeDating(regime, charge);
    place(out, at, 'refunds', chargeCategory(charge.purpose), -refund.amountCents);
  }

  for (const receipt of args.receipts) {
    const date =
      regime === 'accrual' && receipt.booking ? localDate(receipt.booking.startsAt) : receipt.date;
    place(out, { date }, 'gross', receipt.category, receipt.amountCents);
  }

  for (const expense of args.expenses) {
    place(out, { date: expense.date }, 'expenses', expense.categoryId, -expense.amountCents);
  }

  return out;
}
