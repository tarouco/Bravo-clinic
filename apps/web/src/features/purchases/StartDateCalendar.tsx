import { addDays, utcToLocal, type AvailabilityMonth, type LocalDate } from '@bravo/core';
import { useEffect, useState } from 'react';
import { DayStrip } from '../../components/booking/DayStrip';
import { datesOfMonth, monthOf } from '../../lib/calendar-dates';

/** Furthest start date offered; the API enforces `calendar.max_advance_days` (REC-11). */
const MAX_ADVANCE_DAYS = 90;

type MonthDay = AvailabilityMonth['days'][number];

/** Start dates are any day from today to the advance limit: occurrences are checked afterwards. */
function startDateDays(month: string, today: LocalDate): MonthDay[] {
  const limit = addDays(today, MAX_ADVANCE_DAYS);
  return datesOfMonth(month).map((date) => ({
    date,
    status: date < today ? 'past' : date > limit ? 'out_of_range' : 'available',
    isHoliday: false,
    holidayName: null,
    hasDiscount: false,
  }));
}

export interface StartDateCalendarProps {
  /** Chosen start date, `YYYY-MM-DD`. */
  value: string | null;
  onSelect: (date: string) => void;
  className?: string;
}

/** Day strip for a package start date ("data base"): today up to the advance limit. */
export function StartDateCalendar({ value, onSelect, className }: StartDateCalendarProps) {
  const today = utcToLocal(new Date()).date;
  const [month, setMonth] = useState(monthOf(value ?? today));
  // A date chosen elsewhere (a suggestion) brings the calendar to its month.
  useEffect(() => {
    if (value) setMonth(monthOf(value));
  }, [value]);
  return (
    <DayStrip
      month={month}
      days={startDateDays(month, today)}
      value={value}
      minMonth={monthOf(today)}
      maxMonth={monthOf(addDays(today, MAX_ADVANCE_DAYS))}
      hideBefore={today}
      onSelect={onSelect}
      onMonthChange={setMonth}
      {...(className ? { className } : {})}
    />
  );
}
