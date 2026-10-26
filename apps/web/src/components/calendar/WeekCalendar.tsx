import { addDays, type LocalDate } from '@bravo/core';
import { dayMonthLabel, weekDates } from '../../lib/calendar-dates';
import { ScheduleGrid, type ScheduleGridProps } from './ScheduleGrid';
import type { NavigateEvent } from './schedule';
import { ScheduleToolbar } from './ScheduleToolbar';

export interface WeekCalendarProps extends Omit<ScheduleGridProps, 'dates'> {
  /** Any date inside the displayed week (weeks run Monday to Sunday). */
  date: LocalDate;
  /** Called with the new week's range when the user goes to the previous/next week or today. */
  onNavigate: (next: NavigateEvent) => void;
}

/** Range of the Monday-to-Sunday week that contains `date`. */
export function weekRange(date: LocalDate): NavigateEvent {
  const dates = weekDates(date);
  return { date, from: dates[0] as LocalDate, to: dates[6] as LocalDate };
}

/** Week schedule: time rows by minute, events, cleanup shading, markers and drag selection. */
export function WeekCalendar({ date, onNavigate, ...grid }: WeekCalendarProps) {
  const dates = weekDates(date);
  const first = dates[0] as LocalDate;
  const last = dates[6] as LocalDate;
  return (
    <div>
      <ScheduleToolbar
        title={`${dayMonthLabel(first)} – ${dayMonthLabel(last)} de ${last.slice(0, 4)}`}
        previousLabel="Semana anterior"
        nextLabel="Próxima semana"
        onPrevious={() => {
          onNavigate(weekRange(addDays(date, -7)));
        }}
        onNext={() => {
          onNavigate(weekRange(addDays(date, 7)));
        }}
        onToday={() => {
          onNavigate(weekRange(grid.today));
        }}
      />
      <ScheduleGrid dates={dates} {...grid} />
    </div>
  );
}
