import { mulDivRoundHalfUp, type Cents } from '../money';

// Proportional package debit (docs/architecture.md section 7.8, PRD 5.3.1).

/** A period's package terms: V_pac = priceCents / (includedMinutes / 60). */
export interface PackageRate {
  priceCents: Cents;
  includedMinutes: number;
}

/** V_pac in cents per hour, rounded half up (160000 / 1200 min → 8000; 100000 / 1800 → 3333). */
export function vPacCents(pkg: PackageRate): Cents {
  return mulDivRoundHalfUp(pkg.priceCents, 60, pkg.includedMinutes);
}

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b;
  while (y !== 0n) [x, y] = [y, x % y];
  return x;
}

/**
 * Minutes debited for a booking: Σ minutes + ceil(Σ max(0, V_slot − V_ref) × minutes / V_pac),
 * with the extra kept as an exact reduced fraction
 * `Σ max(0, Δ) × minutes × includedMinutes / (priceCents × 60)` and one ceiling over the sum.
 */
export function packageDebitMinutes(args: {
  segments: { minutes: number; vSlotCentsPerHour: Cents }[];
  vRefCentsPerHour: Cents;
  pkg: PackageRate;
}): { minutes: number; extraMinutesExact: { num: bigint; den: bigint } } {
  const included = BigInt(args.pkg.includedMinutes);
  let num = 0n;
  let duration = 0;
  for (const segment of args.segments) {
    duration += segment.minutes;
    const delta = segment.vSlotCentsPerHour - args.vRefCentsPerHour;
    if (delta > 0) num += BigInt(delta) * BigInt(segment.minutes) * included;
  }
  let den = BigInt(args.pkg.priceCents) * 60n;
  if (num === 0n) return { minutes: duration, extraMinutesExact: { num: 0n, den: 1n } };
  const divisor = gcd(num, den);
  num /= divisor;
  den /= divisor;
  const extra = Number((num + den - 1n) / den);
  return { minutes: duration + extra, extraMinutesExact: { num, den } };
}

const minutesFormat = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

/**
 * Extrato formula text (REC-41): "60 min + 18 min de excedente = 78 min", or "120 min" when the
 * debit equals the booking duration.
 */
export function formatDebitDetail(detail: {
  durationMinutes: number;
  debitMinutes: number;
}): string {
  const extra = detail.debitMinutes - detail.durationMinutes;
  const total = `${minutesFormat.format(detail.debitMinutes)} min`;
  if (extra <= 0) return total;
  return `${minutesFormat.format(detail.durationMinutes)} min + ${minutesFormat.format(extra)} min de excedente = ${total}`;
}
