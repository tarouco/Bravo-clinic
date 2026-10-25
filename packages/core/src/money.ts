/** Integer cents. Every monetary value in the system is an integer number of cents. */
export type Cents = number;

/** Returns `v` when it is a safe integer; throws otherwise. */
export function assertCents(v: number): Cents {
  if (!Number.isSafeInteger(v)) {
    throw new Error(`Expected integer cents, received ${String(v)}`);
  }
  return v;
}

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** 160000 -> "R$ 1.600,00" (U+00A0 between "R$" and the digits). */
export function formatBRL(cents: Cents): string {
  return brl.format(assertCents(cents) / 100);
}

const BRL_GROUPED = /^\d{1,3}(\.\d{3})*(,\d{1,2})?$/;
const BRL_PLAIN = /^\d+(,\d{1,2})?$/;

/**
 * "1.600,00" | "R$ 97" | "97,5" -> 160000 | 9700 | 9750. Returns null when the input is not a
 * non-negative BRL amount with at most two decimal places.
 */
export function parseBRLToCents(input: string): Cents | null {
  const text = input.replace(/R\$/g, '').replace(/\s/g, '');
  if (!BRL_GROUPED.test(text) && !BRL_PLAIN.test(text)) return null;
  const [intPart = '', fracPart = ''] = text.replace(/\./g, '').split(',');
  const cents = Number(intPart) * 100 + Number(fracPart.padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
}

function bigAbs(v: bigint): bigint {
  return v < 0n ? -v : v;
}

/**
 * Integer a*b/c rounded half up (exact halves round away from zero, so the result is symmetric for
 * negative values). The product is computed with BigInt, so it never loses precision.
 */
export function mulDivRoundHalfUp(a: number, b: number, c: number): number {
  assertCents(a);
  assertCents(b);
  assertCents(c);
  if (c === 0) throw new Error('Division by zero');
  const num = BigInt(a) * BigInt(b);
  const den = BigInt(c);
  const negative = num < 0n !== den < 0n;
  const absNum = bigAbs(num);
  const absDen = bigAbs(den);
  const quotient = (2n * absNum + absDen) / (2n * absDen);
  const result = Number(negative ? -quotient : quotient);
  return assertCents(result);
}

/** Percentage of an amount in cents, rounded half up: (14550, 50) -> 7275; (9701, 50) -> 4851. */
export function percentOfCents(cents: Cents, percent: number): Cents {
  const bp = percent * 100;
  if (!Number.isFinite(bp) || Math.abs(bp - Math.round(bp)) > 1e-9) {
    throw new Error(`Percent must have at most two decimal places, received ${String(percent)}`);
  }
  return basisPointsOfCents(cents, Math.round(bp));
}

/** Basis points of an amount in cents, rounded half up. 1000 bp = 10%. */
export function basisPointsOfCents(cents: Cents, bp: number): Cents {
  return mulDivRoundHalfUp(cents, bp, 10_000);
}

/** Integer ceil(a / b). */
export function ceilDiv(a: number, b: number): number {
  assertCents(a);
  assertCents(b);
  if (b === 0) throw new Error('Division by zero');
  const bigA = BigInt(a);
  const bigB = BigInt(b);
  let quotient = bigA / bigB;
  if (bigA % bigB !== 0n && bigA < 0n === bigB < 0n) quotient += 1n;
  return Number(quotient);
}
