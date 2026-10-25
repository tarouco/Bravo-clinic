import { describe, expect, it } from 'vitest';
import { weekdayOf } from '../time';
import { holidaySeed } from './holidays-seed';

const scLocalDates = [
  '2026-06-04',
  '2026-06-15',
  '2026-08-16',
  '2026-12-08',
  '2027-05-27',
  '2027-06-15',
  '2027-08-15',
  '2027-12-08',
];

describe('holidaySeed (FND-39 data)', () => {
  it('has 28 rows: 20 national, 2 state, 6 municipal', () => {
    expect(holidaySeed).toHaveLength(28);
    expect(holidaySeed.filter((h) => h.scope === 'national')).toHaveLength(20);
    expect(holidaySeed.filter((h) => h.scope === 'state')).toHaveLength(2);
    expect(holidaySeed.filter((h) => h.scope === 'municipal')).toHaveLength(6);
  });

  it('holds the eight SC and Itajaí dates, and only 2027-08-15 needs review', () => {
    const regional = holidaySeed.filter((h) => h.scope !== 'national').map((h) => h.date);
    expect([...regional].sort()).toEqual(scLocalDates);
    expect(holidaySeed.filter((h) => h.needsReview).map((h) => h.date)).toEqual(['2027-08-15']);
  });

  it('places Data Magna 2026 and 2027 on a Sunday (ISO weekday 7)', () => {
    expect(weekdayOf('2026-08-16')).toBe(7);
    expect(weekdayOf('2027-08-15')).toBe(7);
    const dataMagna = holidaySeed.filter((h) => h.scope === 'state').map((h) => h.date);
    expect(dataMagna).toEqual(['2026-08-16', '2027-08-15']);
  });

  it('has no duplicate (date, name) pair', () => {
    const pairs = holidaySeed.map((h) => `${h.date}|${h.name}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });
});
