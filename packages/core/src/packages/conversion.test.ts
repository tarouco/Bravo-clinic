import { describe, expect, it } from 'vitest';
import { convertPackageBalance } from './conversion';
import {
  fixedScheduleCompensationCents,
  hourPackageCompensationMinutes,
  periodDaysOf,
} from './compensation';

describe('convertPackageBalance (REC-71)', () => {
  const from = { priceCents: 160000, includedMinutes: 1200 }; // R$ 80/h
  const to = { priceCents: 225000, includedMinutes: 1800 }; // R$ 75/h

  it('360 min on 160000/1200 → 225000/1800 = 384 min', () => {
    expect(convertPackageBalance({ remainingMinutes: 360, from, to })).toBe(384);
  });

  it('0 remaining → 0', () => {
    expect(convertPackageBalance({ remainingMinutes: 0, from, to })).toBe(0);
  });

  it('rounds half up to the minute: 0.5 → 1, 1.5 → 2, 2.4 → 2', () => {
    const cheap = { priceCents: 1000, includedMinutes: 60 };
    const dear = { priceCents: 2000, includedMinutes: 60 };
    expect(convertPackageBalance({ remainingMinutes: 1, from: cheap, to: dear })).toBe(1);
    expect(convertPackageBalance({ remainingMinutes: 3, from: cheap, to: dear })).toBe(2);
    // 6 × 1000 × 60 / (60 × 2500) = 2.4
    expect(
      convertPackageBalance({
        remainingMinutes: 6,
        from: cheap,
        to: { priceCents: 2500, includedMinutes: 60 },
      }),
    ).toBe(2);
  });

  it('converting back to the same rate keeps the minutes', () => {
    expect(convertPackageBalance({ remainingMinutes: 750, from, to: from })).toBe(750);
  });
});

describe('closed-day compensation (REC-96)', () => {
  it('periodDaysOf: monthly 30, bimonthly 60, quarterly 90', () => {
    expect(periodDaysOf('monthly')).toBe(30);
    expect(periodDaysOf('bimonthly')).toBe(60);
    expect(periodDaysOf('quarterly')).toBe(90);
  });

  it.each([
    [1200, 30, 40],
    [2400, 60, 40],
    [1800, 90, 20],
  ] as const)('hourPackageCompensationMinutes(%s, %s) = %s', (included, days, expected) => {
    expect(hourPackageCompensationMinutes(included, days)).toBe(expected);
  });

  it('hourPackageCompensationMinutes rounds half up: 45 / 30 = 1.5 → 2; 40 / 30 → 1', () => {
    expect(hourPackageCompensationMinutes(45, 30)).toBe(2);
    expect(hourPackageCompensationMinutes(40, 30)).toBe(1);
  });

  it('fixedScheduleCompensationCents(616000, 30) = 20533 (R$ 205,33)', () => {
    expect(fixedScheduleCompensationCents(616000, 30)).toBe(20533);
  });

  it('fixedScheduleCompensationCents rounds half up: 15 / 30 = 0.5 → 1', () => {
    expect(fixedScheduleCompensationCents(15, 30)).toBe(1);
  });
});
