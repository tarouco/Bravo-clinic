import { weekdayOf, type LocalDate } from '../time';

export type DayType = 'weekday' | 'weekend_holiday';

export interface HolidayRef {
  date: LocalDate;
  isClosed: boolean;
}

export type BusinessDayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun' | 'holiday';

export interface BusinessHoursRow {
  dayType: BusinessDayKey;
  isClosed: boolean;
  openMinute: number;
  closeMinute: number;
}

export interface ClosedDayRef {
  date: LocalDate;
  /** null = the whole clinic. */
  roomId: string | null;
}

export interface BusinessWindow {
  openMinute: number;
  closeMinute: number;
  isHoliday: boolean;
}

const WEEKDAY_KEYS: Record<number, BusinessDayKey> = {
  1: 'mon',
  2: 'tue',
  3: 'wed',
  4: 'thu',
  5: 'fri',
  6: 'sat',
  7: 'sun',
};

/** Saturday, Sunday and holidays use the weekend/holiday rates (PRD 5.3). */
export function resolveDayType(date: LocalDate, holidays: HolidayRef[]): DayType {
  if (weekdayOf(date) >= 6) return 'weekend_holiday';
  return holidays.some((h) => h.date === date) ? 'weekend_holiday' : 'weekday';
}

/**
 * Opening hours of a room on a date, or null when the room is closed: a clinic or room closed day,
 * a holiday marked closed, or a closed business-hours row. Open holidays use the `holiday` row.
 */
export function businessWindow(args: {
  date: LocalDate;
  roomId: string;
  hours: BusinessHoursRow[];
  holidays: HolidayRef[];
  closedDays: ClosedDayRef[];
}): BusinessWindow | null {
  const { date, roomId } = args;
  const closedDay = args.closedDays.some(
    (c) => c.date === date && (c.roomId === null || c.roomId === roomId),
  );
  if (closedDay) return null;
  const holidays = args.holidays.filter((h) => h.date === date);
  if (holidays.some((h) => h.isClosed)) return null;
  const isHoliday = holidays.length > 0;
  const key = isHoliday ? 'holiday' : WEEKDAY_KEYS[weekdayOf(date)];
  const row = args.hours.find((r) => r.dayType === key);
  if (!row || row.isClosed) return null;
  return { openMinute: row.openMinute, closeMinute: row.closeMinute, isHoliday };
}
