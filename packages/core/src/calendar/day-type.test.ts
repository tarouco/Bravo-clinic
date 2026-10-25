import { describe, expect, it } from 'vitest';
import { businessWindow, resolveDayType, type BusinessHoursRow, type HolidayRef } from './day-type';

const ROOM = 'principal';
const OTHER_ROOM = 'secundaria';

// Factory hours (PRD 5.2): Mon-Fri 07:00-00:00, Sat, Sun and holidays 09:00-00:00.
const hours: BusinessHoursRow[] = [
  { dayType: 'mon', isClosed: false, openMinute: 420, closeMinute: 1440 },
  { dayType: 'tue', isClosed: false, openMinute: 420, closeMinute: 1440 },
  { dayType: 'wed', isClosed: false, openMinute: 420, closeMinute: 1440 },
  { dayType: 'thu', isClosed: false, openMinute: 420, closeMinute: 1440 },
  { dayType: 'fri', isClosed: false, openMinute: 420, closeMinute: 1440 },
  { dayType: 'sat', isClosed: false, openMinute: 540, closeMinute: 1440 },
  { dayType: 'sun', isClosed: false, openMinute: 540, closeMinute: 1440 },
  { dayType: 'holiday', isClosed: false, openMinute: 540, closeMinute: 1440 },
];
const finados: HolidayRef = { date: '2026-11-02', isClosed: false };

describe('resolveDayType (NUC-09)', () => {
  it('is weekend_holiday on Saturday 2026-10-31', () => {
    expect(resolveDayType('2026-10-31', [])).toBe('weekend_holiday');
  });
  it('is weekend_holiday on Sunday 2026-11-01', () => {
    expect(resolveDayType('2026-11-01', [])).toBe('weekend_holiday');
  });
  it('is weekend_holiday on the Monday holiday 2026-11-02', () => {
    expect(resolveDayType('2026-11-02', [finados])).toBe('weekend_holiday');
  });
  it('is weekday on Tuesday 2026-10-27 and on 2026-11-02 without the holiday', () => {
    expect(resolveDayType('2026-10-27', [finados])).toBe('weekday');
    expect(resolveDayType('2026-11-02', [])).toBe('weekday');
  });
});

describe('businessWindow (NUC-07, NUC-08)', () => {
  const base = { roomId: ROOM, hours, holidays: [finados], closedDays: [] };

  it('returns the weekday row on an open weekday', () => {
    expect(businessWindow({ ...base, date: '2026-10-27' })).toEqual({
      openMinute: 420,
      closeMinute: 1440,
      isHoliday: false,
    });
  });

  it('returns the holiday row on an open holiday', () => {
    expect(businessWindow({ ...base, date: '2026-11-02' })).toEqual({
      openMinute: 540,
      closeMinute: 1440,
      isHoliday: true,
    });
  });

  it('uses edited holiday hours instead of the weekday row', () => {
    const edited = hours.map((r) =>
      r.dayType === 'holiday' ? { ...r, openMinute: 600, closeMinute: 1080 } : r,
    );
    expect(businessWindow({ ...base, hours: edited, date: '2026-11-02' })).toEqual({
      openMinute: 600,
      closeMinute: 1080,
      isHoliday: true,
    });
  });

  it('is null on a clinic closed day', () => {
    const closedDays = [{ date: '2026-10-27' as const, roomId: null }];
    expect(businessWindow({ ...base, closedDays, date: '2026-10-27' })).toBeNull();
  });

  it('is null on a closed day of that room and open for another room', () => {
    const closedDays = [{ date: '2026-10-27' as const, roomId: ROOM }];
    expect(businessWindow({ ...base, closedDays, date: '2026-10-27' })).toBeNull();
    expect(businessWindow({ ...base, roomId: OTHER_ROOM, closedDays, date: '2026-10-27' })).toEqual(
      {
        openMinute: 420,
        closeMinute: 1440,
        isHoliday: false,
      },
    );
  });

  it('is null on a holiday marked closed', () => {
    const holidays = [{ date: '2026-11-02' as const, isClosed: true }];
    expect(businessWindow({ ...base, holidays, date: '2026-11-02' })).toBeNull();
  });

  it('is null on a weekday whose row is closed', () => {
    const closedTue = hours.map((r) => (r.dayType === 'tue' ? { ...r, isClosed: true } : r));
    expect(businessWindow({ ...base, hours: closedTue, date: '2026-10-27' })).toBeNull();
    expect(businessWindow({ ...base, hours: closedTue, date: '2026-10-28' })).not.toBeNull();
  });
});
