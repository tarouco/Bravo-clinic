import { addDays, weekdayOf, type LocalDate } from '@bravo/core';

// Calendar arithmetic on `YYYY-MM-DD` / `YYYY-MM` strings. Weeks start on Monday (ISO).

export const WEEKDAY_SHORT = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'] as const;

const pad2 = (n: number): string => String(n).padStart(2, '0');

export const monthOf = (date: string): string => date.slice(0, 7);

/** "2026-10" + 1 -> "2026-11". */
export function shiftMonth(month: string, delta: number): string {
  const [year = 0, mon = 1] = month.split('-').map(Number);
  const index = year * 12 + (mon - 1) + delta;
  return `${String(Math.floor(index / 12))}-${pad2((index % 12) + 1)}`;
}

export function daysInMonth(month: string): number {
  const [year = 0, mon = 1] = month.split('-').map(Number);
  return new Date(Date.UTC(year, mon, 0)).getUTCDate();
}

/** Every date of the month, as `LocalDate`s. */
export function datesOfMonth(month: string): LocalDate[] {
  return Array.from(
    { length: daysInMonth(month) },
    (_, i) => `${month}-${pad2(i + 1)}` as LocalDate,
  );
}

/** Monday of the week that contains `date`. */
export function startOfWeek(date: LocalDate): LocalDate {
  return addDays(date, 1 - weekdayOf(date));
}

/** Seven dates from Monday. */
export function weekDates(date: LocalDate): LocalDate[] {
  const monday = startOfWeek(date);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** "outubro de 2026". */
export function monthLabel(month: string): string {
  const [year = 0, mon = 1] = month.split('-').map(Number);
  return new Date(Date.UTC(year, mon - 1, 1)).toLocaleDateString('pt-BR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** "2 de novembro". */
export function dayMonthLabel(date: string): string {
  const [year = 0, mon = 1, day = 1] = date.split('-').map(Number);
  return new Date(Date.UTC(year, mon - 1, day)).toLocaleDateString('pt-BR', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
}
