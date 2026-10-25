import { addDays, diffDays, localToUtc, type LocalDate } from '../time';

// Subscription period dates (REC-10, REC-46, REC-57, REC-58). Periods are half-open local date
// ranges [startsOn, endsOn).

export function periodBounds(
  startsOn: LocalDate,
  periodDays: number,
): { startsOn: LocalDate; endsOn: LocalDate } {
  return { startsOn, endsOn: addDays(startsOn, periodDays) };
}

/** Local 00:00 of `startsOn − renewalDaysBefore` ('2026-12-02', 2 → 2026-11-30T03:00:00.000Z). */
export function chargeDueAt(startsOn: LocalDate, renewalDaysBefore: number): Date {
  return localToUtc(addDays(startsOn, -renewalDaysBefore), 0);
}

export function isDateInPeriod(
  date: LocalDate,
  period: { startsOn: LocalDate; endsOn: LocalDate },
): boolean {
  return diffDays(period.startsOn, date) >= 0 && diffDays(date, period.endsOn) > 0;
}

/** The date an unpaid renewal ends the subscription: `startsOn + graceDays` (2026-12-09). */
export function graceEndsOn(startsOn: LocalDate, graceDays: number): LocalDate {
  return addDays(startsOn, graceDays);
}

/** Dates of the period-ending e-mails, 7 and 1 days before `endsOn` by default. */
export function periodEndNoticeDates(
  endsOn: LocalDate,
  daysBefore: number[] = [7, 1],
): LocalDate[] {
  return daysBefore.map((days) => addDays(endsOn, -days));
}
