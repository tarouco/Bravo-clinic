import { describe, expect, it } from 'vitest';
import {
  chargeDueAt,
  graceEndsOn,
  isDateInPeriod,
  periodBounds,
  periodEndNoticeDates,
} from './period';

describe('period dates (REC-10, REC-46, REC-57, REC-58)', () => {
  it('periodBounds: base 2026-11-02, 30 days → endsOn 2026-12-02 (exclusive)', () => {
    expect(periodBounds('2026-11-02', 30)).toEqual({
      startsOn: '2026-11-02',
      endsOn: '2026-12-02',
    });
    expect(periodBounds('2026-11-02', 60).endsOn).toBe('2027-01-01');
  });

  it('chargeDueAt: renewal 2026-12-02, 2 days before → local 00:00 of 2026-11-30 = 03:00Z', () => {
    expect(chargeDueAt('2026-12-02', 2).toISOString()).toBe('2026-11-30T03:00:00.000Z');
    expect(chargeDueAt('2026-12-02', 0).toISOString()).toBe('2026-12-02T03:00:00.000Z');
  });

  it('graceEndsOn: 2026-12-02 + 7 days → 2026-12-09', () => {
    expect(graceEndsOn('2026-12-02', 7)).toBe('2026-12-09');
  });

  it('periodEndNoticeDates: endsOn 2026-12-02 → 2026-11-25 and 2026-12-01', () => {
    expect(periodEndNoticeDates('2026-12-02')).toEqual(['2026-11-25', '2026-12-01']);
  });

  it('isDateInPeriod uses [startsOn, endsOn)', () => {
    const p = { startsOn: '2026-11-02', endsOn: '2026-12-02' } as const;
    expect(isDateInPeriod('2026-11-02', p)).toBe(true);
    expect(isDateInPeriod('2026-12-01', p)).toBe(true);
    expect(isDateInPeriod('2026-12-02', p)).toBe(false);
    expect(isDateInPeriod('2026-11-01', p)).toBe(false);
  });
});
