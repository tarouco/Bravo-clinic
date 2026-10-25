import type { Cents } from '../money';

// Balance allocation rules shared by the minute and credit services (REC-25, REC-26, REC-107,
// REC-109). Callers lock the rows and persist what these functions decide.

export interface MinuteLot {
  id: string;
  remaining: number;
  expiresAt: Date;
  /** Breaks ties of `expiresAt`; without it, ties keep the input order. */
  createdAt?: Date;
}

export interface CreditLot {
  id: string;
  remainingCents: Cents;
  expiresAt: Date;
  createdAt: Date;
}

function byExpiryThenCreation(
  a: { expiresAt: Date; createdAt?: Date },
  b: { expiresAt: Date; createdAt?: Date },
): number {
  const byExpiry = a.expiresAt.getTime() - b.expiresAt.getTime();
  if (byExpiry !== 0 || a.createdAt === undefined || b.createdAt === undefined) return byExpiry;
  return a.createdAt.getTime() - b.createdAt.getTime();
}

/**
 * Package minutes first (when `usePackage`: the booking date is inside the active period and the
 * subscription is not suspended), then extra lots by expiry. A lot is usable only when it expires
 * after now and after the booking start. Insufficient → nothing allocated, `available` reported
 * (no mixed payment).
 */
export function allocateMinutes(args: {
  debit: number;
  packageAvailable: number;
  lots: MinuteLot[];
  bookingStartsAt: Date;
  now: Date;
  usePackage: boolean;
}): {
  fromPackage: number;
  fromLots: { lotId: string; minutes: number }[];
  sufficient: boolean;
  available: number;
} {
  const limit = Math.max(args.now.getTime(), args.bookingStartsAt.getTime());
  const lots = args.lots
    .filter((lot) => lot.remaining > 0 && lot.expiresAt.getTime() > limit)
    .sort(byExpiryThenCreation);
  const packageAvailable = args.usePackage ? args.packageAvailable : 0;
  const available = packageAvailable + lots.reduce((sum, lot) => sum + lot.remaining, 0);
  if (available < args.debit) {
    return { fromPackage: 0, fromLots: [], sufficient: false, available };
  }
  const fromPackage = Math.min(args.debit, packageAvailable);
  let left = args.debit - fromPackage;
  const fromLots: { lotId: string; minutes: number }[] = [];
  for (const lot of lots) {
    if (left === 0) break;
    const minutes = Math.min(lot.remaining, left);
    fromLots.push({ lotId: lot.id, minutes });
    left -= minutes;
  }
  return { fromPackage, fromLots, sufficient: true, available };
}

/**
 * Credit lots used for a payment: unexpired lots by expiry then creation, never more than a lot
 * holds; uses `min(available, amount)` (REC-107).
 */
export function allocateCredits(
  lots: CreditLot[],
  amountCents: Cents,
  now: Date,
): { lotId: string; cents: Cents }[] {
  const usable = lots
    .filter((lot) => lot.remainingCents > 0 && lot.expiresAt.getTime() > now.getTime())
    .sort(byExpiryThenCreation);
  const out: { lotId: string; cents: Cents }[] = [];
  let left = amountCents;
  for (const lot of usable) {
    if (left <= 0) break;
    const cents = Math.min(lot.remainingCents, left);
    out.push({ lotId: lot.id, cents });
    left -= cents;
  }
  return out;
}

/**
 * Split a refund between cash and credit (REC-109): the retained amount consumes the credit
 * portion first, so `creditRefund = credit − min(credit, retained)`.
 */
export function allocateRefund(args: {
  cashPaidCents: Cents;
  creditPaidCents: Cents;
  refundCents: Cents;
}): { cashRefundCents: Cents; creditRefundCents: Cents } {
  const { cashPaidCents, creditPaidCents, refundCents } = args;
  const paid = cashPaidCents + creditPaidCents;
  if (refundCents < 0 || refundCents > paid) {
    throw new Error(`Refund ${String(refundCents)} outside 0..${String(paid)}`);
  }
  const retained = paid - refundCents;
  const creditRefundCents = creditPaidCents - Math.min(creditPaidCents, retained);
  return { cashRefundCents: refundCents - creditRefundCents, creditRefundCents };
}
