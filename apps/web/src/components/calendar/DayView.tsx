import { addDays, type LocalDate } from '@bravo/core';
import { dayMonthLabel } from '../../lib/calendar-dates';
import { ScheduleGrid, type ScheduleGridProps } from './ScheduleGrid';
import type { NavigateEvent } from './schedule';
import { ScheduleToolbar } from './ScheduleToolbar';

export interface DayViewProps extends Omit<ScheduleGridProps, 'dates'> {
  date: LocalDate;
  /** Called with the new day (from = to) when the user goes to the previous/next day or today. */
  onNavigate: (next: NavigateEvent) => void;
}

const dayRange = (date: LocalDate): NavigateEvent => ({ date, from: date, to: date });

/** Single-day schedule with the same rendering as the week view. */
export function DayView({ date, onNavigate, ...grid }: DayViewProps) {
  return (
    <div>
      <ScheduleToolbar
        title={`${dayMonthLabel(date)} de ${date.slice(0, 4)}`}
        previousLabel="Dia anterior"
        nextLabel="Próximo dia"
        onPrevious={() => {
          onNavigate(dayRange(addDays(date, -1)));
        }}
        onNext={() => {
          onNavigate(dayRange(addDays(date, 1)));
        }}
        onToday={() => {
          onNavigate(dayRange(grid.today));
        }}
      />
      <ScheduleGrid dates={[date]} {...grid} />
    </div>
  );
}
