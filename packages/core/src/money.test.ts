import { describe, expect, it } from 'vitest';
import {
  assertCents,
  basisPointsOfCents,
  ceilDiv,
  formatBRL,
  mulDivRoundHalfUp,
  parseBRLToCents,
  percentOfCents,
} from './money';

const NBSP = ' ';

describe('assertCents (FND-07 guard)', () => {
  it('returns integer values unchanged', () => {
    expect(assertCents(0)).toBe(0);
    expect(assertCents(160000)).toBe(160000);
  });

  it('throws on non-integer and non-finite values', () => {
    expect(() => assertCents(1.5)).toThrow();
    expect(() => assertCents(Number.NaN)).toThrow();
    expect(() => assertCents(Number.POSITIVE_INFINITY)).toThrow();
  });
});

describe('formatBRL (FND-07)', () => {
  it('formats 160000 as "R$ 1.600,00" with U+00A0 after R$', () => {
    expect(formatBRL(160000)).toBe(`R$${NBSP}1.600,00`);
  });

  it('formats 9700 as "R$ 97,00"', () => {
    expect(formatBRL(9700)).toBe(`R$${NBSP}97,00`);
  });

  it('formats zero as "R$ 0,00"', () => {
    expect(formatBRL(0)).toBe(`R$${NBSP}0,00`);
  });

  it('rejects non-integer cents', () => {
    expect(() => formatBRL(97.5)).toThrow();
  });
});

describe('percentOfCents (FND-08)', () => {
  it('returns 7275 for (14550, 50)', () => {
    expect(percentOfCents(14550, 50)).toBe(7275);
  });

  it('rounds half up: (9701, 50) is 4851', () => {
    expect(percentOfCents(9701, 50)).toBe(4851);
  });

  it('handles 0 and 100 percent', () => {
    expect(percentOfCents(9700, 0)).toBe(0);
    expect(percentOfCents(9700, 100)).toBe(9700);
  });
});

describe('basisPointsOfCents', () => {
  it('treats 1000 bp as 10% rounded half up', () => {
    expect(basisPointsOfCents(9705, 1000)).toBe(971);
    expect(basisPointsOfCents(10000, 1000)).toBe(1000);
  });
});

describe('mulDivRoundHalfUp', () => {
  it('returns 11200 for (28000, 60, 150)', () => {
    expect(mulDivRoundHalfUp(28000, 60, 150)).toBe(11200);
  });

  it('rounds exact halves up and keeps exact results', () => {
    expect(mulDivRoundHalfUp(1, 1, 2)).toBe(1);
    expect(mulDivRoundHalfUp(3, 1, 2)).toBe(2);
    expect(mulDivRoundHalfUp(1, 1, 3)).toBe(0);
    expect(mulDivRoundHalfUp(2, 1, 3)).toBe(1);
  });

  it('does not lose precision above 2^53 in the intermediate product', () => {
    expect(mulDivRoundHalfUp(9_007_199_254_740_991, 3, 3)).toBe(9_007_199_254_740_991);
  });

  it('rejects a zero divisor and non-integer arguments', () => {
    expect(() => mulDivRoundHalfUp(1, 1, 0)).toThrow();
    expect(() => mulDivRoundHalfUp(1.5, 1, 2)).toThrow();
  });
});

describe('ceilDiv', () => {
  it('rounds up positive quotients', () => {
    expect(ceilDiv(7, 2)).toBe(4);
    expect(ceilDiv(8, 2)).toBe(4);
    expect(ceilDiv(0, 5)).toBe(0);
  });

  it('rejects a zero divisor', () => {
    expect(() => ceilDiv(1, 0)).toThrow();
  });
});

describe('parseBRLToCents (FND-09)', () => {
  it('parses "1.600,00" as 160000', () => {
    expect(parseBRLToCents('1.600,00')).toBe(160000);
  });

  it('parses "R$ 97" as 9700 (also with U+00A0)', () => {
    expect(parseBRLToCents('R$ 97')).toBe(9700);
    expect(parseBRLToCents(`R$${NBSP}97`)).toBe(9700);
  });

  it('parses "97,5" as 9750', () => {
    expect(parseBRLToCents('97,5')).toBe(9750);
  });

  it('round-trips formatBRL output', () => {
    expect(parseBRLToCents(formatBRL(160000))).toBe(160000);
  });

  it('returns null for "abc", "" and "1,2,3"', () => {
    expect(parseBRLToCents('abc')).toBeNull();
    expect(parseBRLToCents('')).toBeNull();
    expect(parseBRLToCents('1,2,3')).toBeNull();
  });

  it('returns null for more than two decimal places', () => {
    expect(parseBRLToCents('97,505')).toBeNull();
  });
});
