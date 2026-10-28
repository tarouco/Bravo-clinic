import { addDays, minuteToHHMM, type LocalDate } from '@bravo/core';
import type { ReactNode } from 'react';
import {
  datesOfMonth,
  dayMonthLabel,
  monthLabel,
  monthOf,
  shiftMonth,
  startOfWeek,
  WEEKDAY_SHORT,
} from '../../lib/calendar-dates';
import { cx, focusRing } from '../ui/cx';
import { HoverCard, type HoverCardTriggerProps } from '../ui/HoverCard';
import {
  layoutDay,
  TONE_CLASSES,
  type DayMarker,
  type NavigateEvent,
  type ScheduleEvent,
} from './schedule';
import { ScheduleToolbar } from './ScheduleToolbar';

const MAX_CHIPS = 3;

export interface MonthCalendarViewProps {
  /** Any date inside the displayed month. */
  date: LocalDate;
  today: LocalDate;
  events: readonly ScheduleEvent[];
  holidays?: readonly DayMarker[];
  closedDays?: readonly DayMarker[];
  /** Called with the visible grid range (at most 42 days) after previous/next/today. */
  onNavigate: (next: NavigateEvent) => void;
  /** Called when a day number is clicked, to drill into the day or week. */
  onSelectDate?: (date: LocalDate) => void;
  /** Content of the card shown while hovering or focusing an event chip; null for none. */
  renderEventCard?: (event: ScheduleEvent) => ReactNode;
  className?: string;
}

/** Visible grid range of a month: Monday of its first week to Sunday of its last. */
export function monthGridRange(date: LocalDate): NavigateEvent {
  const dates = datesOfMonth(monthOf(date));
  const from = startOfWeek(dates[0] as LocalDate);
  const to = addDays(startOfWeek(dates[dates.length - 1] as LocalDate), 6);
  return { date, from, to };
}

function gridDates(date: LocalDate): LocalDate[] {
  const { from, to } = monthGridRange(date);
  const out: LocalDate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Month schedule: day cells with event chips (customer and room), holiday and closed markers. */
export function MonthCalendarView({
  date,
  today,
  events,
  holidays = [],
  closedDays = [],
  onNavigate,
  onSelectDate,
  renderEventCard,
  className,
}: MonthCalendarViewProps) {
  const month = monthOf(date);
  const goTo = (target: LocalDate) => {
    onNavigate(monthGridRange(target));
  };
  return (
    <div className={className}>
      <ScheduleToolbar
        title={monthLabel(month)}
        previousLabel="Mês anterior"
        nextLabel="Próximo mês"
        onPrevious={() => {
          goTo(`${shiftMonth(month, -1)}-01` as LocalDate);
        }}
        onNext={() => {
          goTo(`${shiftMonth(month, 1)}-01` as LocalDate);
        }}
        onToday={() => {
          goTo(today);
        }}
      />
      {/* Focusable so a keyboard user can scroll the month sideways on a narrow screen. */}
      <div
        role="region"
        aria-label="Calendário do mês"
        tabIndex={0}
        className={cx(
          'overflow-x-auto rounded-card border border-hairline bg-surface-raised',
          focusRing,
        )}
      >
        <div className="min-w-[40rem]">
          <div className="grid grid-cols-7 border-b border-hairline bg-surface-stone text-center font-caption text-caption uppercase tracking-[0.08em] text-ink-muted">
            {WEEKDAY_SHORT.map((name) => (
              <span key={name} className="py-space-xs">
                {name}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {gridDates(date).map((day) => {
              const holiday = holidays.find((h) => h.date === day);
              const closed = closedDays.find((c) => c.date === day);
              const dayEvents = layoutDay(events, day, false);
              const inMonth = monthOf(day) === month;
              return (
                <div
                  key={day}
                  data-date={day}
                  className={cx(
                    'min-h-24 border-b border-l border-hairline p-space-xs',
                    !inMonth && 'bg-surface-container-low text-ink-muted',
                    closed && 'bg-surface-dim/60',
                  )}
                >
                  <button
                    type="button"
                    aria-label={dayMonthLabel(day)}
                    onClick={() => onSelectDate?.(day)}
                    className={cx(
                      'mb-1 flex h-7 w-7 items-center justify-center rounded-full font-small text-small',
                      day === today ? 'bg-bronze text-on-bronze' : 'text-ink',
                      focusRing,
                    )}
                  >
                    {Number(day.slice(8))}
                  </button>
                  {holiday ? (
                    <p className="truncate font-caption text-caption text-bronze">
                      {holiday.label}
                    </p>
                  ) : null}
                  {closed ? (
                    <p className="truncate font-caption text-caption text-error">{closed.label}</p>
                  ) : null}
                  <ul className="space-y-0.5">
                    {dayEvents.slice(0, MAX_CHIPS).map(({ event, startMinute }) => (
                      <li key={event.id}>
                        <EventChip
                          event={event}
                          startMinute={startMinute}
                          card={renderEventCard?.(event) ?? null}
                        />
                      </li>
                    ))}
                  </ul>
                  {dayEvents.length > MAX_CHIPS ? (
                    <p className="font-caption text-caption text-ink-muted">
                      +{dayEvents.length - MAX_CHIPS} mais
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function EventChip({
  event,
  startMinute,
  card,
}: {
  event: ScheduleEvent;
  startMinute: number;
  card: ReactNode;
}) {
  const chip = (props: Partial<HoverCardTriggerProps>) => (
    <button
      type="button"
      onClick={event.onClick}
      className={cx(
        'block w-full truncate rounded-control border px-1 text-left font-caption text-caption',
        TONE_CLASSES[event.tone ?? (event.kind === 'block' ? 'block' : 'confirmed')],
        focusRing,
      )}
      {...props}
    >
      {minuteToHHMM(startMinute)} {event.title}
    </button>
  );
  return card ? (
    <HoverCard label={event.title} trigger={(props) => chip(props)} align="start">
      {card}
    </HoverCard>
  ) : (
    chip({})
  );
}
