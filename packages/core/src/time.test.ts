import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  addDays,
  CLINIC_TZ,
  diffDays,
  formatDateBR,
  formatDateTimeBR,
  formatTimeBR,
  localDayRangeUtc,
  localToUtc,
  minuteToHHMM,
  utcToLocal,
  weekdayOf,
} from './time';

describe('CLINIC_TZ', () => {
  it('is the IANA zone America/Sao_Paulo', () => {
    expect(CLINIC_TZ).toBe('America/Sao_Paulo');
  });
});

describe('localToUtc (FND-10)', () => {
  it('converts 2026-10-27 10:00 to 2026-10-27T13:00:00.000Z', () => {
    expect(localToUtc('2026-10-27', 600).toISOString()).toBe('2026-10-27T13:00:00.000Z');
  });

  it('treats minute 1440 as 00:00 of the next local day', () => {
    expect(localToUtc('2026-10-27', 1440).toISOString()).toBe('2026-10-28T03:00:00.000Z');
  });

  it('converts local midnight', () => {
    expect(localToUtc('2026-10-27', 0).toISOString()).toBe('2026-10-27T03:00:00.000Z');
  });
});

describe('utcToLocal (FND-11)', () => {
  it('maps 2026-10-28T02:30:00Z to the previous local day 23:30, ISO weekday 2', () => {
    expect(utcToLocal(new Date('2026-10-28T02:30:00Z'))).toEqual({
      date: '2026-10-27',
      minuteOfDay: 1410,
      weekday: 2,
    });
  });

  it('round-trips with localToUtc', () => {
    const instant = localToUtc('2026-12-31', 570);
    expect(utcToLocal(instant)).toEqual({ date: '2026-12-31', minuteOfDay: 570, weekday: 4 });
  });

  it('reports Sunday as ISO weekday 7', () => {
    expect(utcToLocal(new Date('2026-11-01T15:00:00Z')).weekday).toBe(7);
  });
});

describe('IANA-derived offsets (FND-12)', () => {
  it('uses the offset in force on each date (Brazil observed DST until 2019)', () => {
    expect(localToUtc('2018-06-10', 600).toISOString()).toBe('2018-06-10T13:00:00.000Z');
    expect(localToUtc('2018-12-10', 600).toISOString()).toBe('2018-12-10T12:00:00.000Z');
    expect(utcToLocal(new Date('2018-12-10T12:00:00Z'))).toEqual({
      date: '2018-12-10',
      minuteOfDay: 600,
      weekday: 1,
    });
  });

  it('time.ts contains no hard-coded UTC offset literal', () => {
    const source = readFileSync(new URL('./time.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/-03:00|-0300/);
  });
});

describe('date arithmetic', () => {
  it('addDays crosses the year boundary', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('addDays accepts negative offsets and leap days', () => {
    expect(addDays('2027-03-01', -1)).toBe('2027-02-28');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('weekdayOf returns the ISO weekday', () => {
    expect(weekdayOf('2026-11-02')).toBe(1);
    expect(weekdayOf('2026-11-08')).toBe(7);
  });

  it('diffDays counts calendar days from the first date to the second', () => {
    expect(diffDays('2026-10-27', '2026-11-02')).toBe(6);
    expect(diffDays('2026-11-02', '2026-10-27')).toBe(-6);
    expect(diffDays('2026-10-27', '2026-10-27')).toBe(0);
  });

  it('localDayRangeUtc spans local midnight to the next local midnight', () => {
    const range = localDayRangeUtc('2026-10-27');
    expect(range.start.toISOString()).toBe('2026-10-27T03:00:00.000Z');
    expect(range.end.toISOString()).toBe('2026-10-28T03:00:00.000Z');
  });
});

describe('formatting (FND-13)', () => {
  it('formatDateTimeBR renders "27/10/2026 10:00"', () => {
    expect(formatDateTimeBR(new Date('2026-10-27T13:00:00Z'))).toBe('27/10/2026 10:00');
  });

  it('formatDateBR and formatTimeBR render the São Paulo wall clock', () => {
    const instant = new Date('2026-10-28T02:30:00Z');
    expect(formatDateBR(instant)).toBe('27/10/2026');
    expect(formatTimeBR(instant)).toBe('23:30');
  });

  it('formats local midnight as 00:00, not 24:00', () => {
    expect(formatTimeBR(new Date('2026-10-27T03:00:00Z'))).toBe('00:00');
  });

  it('minuteToHHMM renders 1440 as "00:00" and 570 as "09:30"', () => {
    expect(minuteToHHMM(1440)).toBe('00:00');
    expect(minuteToHHMM(570)).toBe('09:30');
    expect(minuteToHHMM(0)).toBe('00:00');
  });
});
