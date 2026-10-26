import { addDays, weekdayOf, type AvailabilityMonth, type LocalDate } from '@bravo/core';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
  dayMonthLabel,
  datesOfMonth,
  monthLabel,
  monthOf,
  shiftMonth,
  WEEKDAY_SHORT,
} from '../../lib/calendar-dates';
import { cx, focusRing } from '../ui/cx';
import { Icon } from '../ui/Icon';

type MonthDay = AvailabilityMonth['days'][number];

export interface MonthCalendarProps {
  /** Displayed month, `YYYY-MM`. */
  month: string;
  /** Day statuses of that month; days without data are shown disabled while loading. */
  days: readonly MonthDay[];
  /** Selected date, `YYYY-MM-DD`. */
  value: string | null;
  onSelect: (date: string) => void;
  onMonthChange: (month: string) => void;
  /** Earliest and latest month the arrows can reach. */
  minMonth?: string;
  maxMonth?: string;
  className?: string;
}

const STATUS_TEXT: Record<MonthDay['status'], string> = {
  available: 'disponível',
  full: 'sem horários',
  closed: 'fechado',
  past: 'data passada',
  out_of_range: 'fora do período de reservas',
};

/** Month picker for the public site: day statuses, holiday marker, roving keyboard focus. */
export function MonthCalendar({
  month,
  days,
  value,
  onSelect,
  onMonthChange,
  minMonth,
  maxMonth,
  className,
}: MonthCalendarProps) {
  const byDate = new Map(days.map((day) => [day.date as string, day]));
  const dates = datesOfMonth(month);
  const leading = weekdayOf(dates[0] as LocalDate) - 1;

  const selectable = (date: string) => byDate.get(date)?.status === 'available';
  const initialFocus =
    (value && monthOf(value) === month ? value : null) ??
    dates.find((date) => selectable(date)) ??
    dates[0];
  const [focusDate, setFocusDate] = useState<string | undefined>(initialFocus);
  const pendingFocus = useRef<string | null>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());

  // The roving stop must stay inside the displayed month.
  const rovingDate = focusDate && monthOf(focusDate) === month ? focusDate : initialFocus;

  useEffect(() => {
    const target = pendingFocus.current;
    if (target && monthOf(target) === month) {
      buttons.current.get(target)?.focus();
      pendingFocus.current = null;
    }
  }, [month]);

  const move = (from: string, delta: number) => {
    const target = addDays(from as LocalDate, delta);
    if (minMonth && monthOf(target) < minMonth) return;
    if (maxMonth && monthOf(target) > maxMonth) return;
    setFocusDate(target);
    if (monthOf(target) === month) buttons.current.get(target)?.focus();
    else {
      pendingFocus.current = target;
      onMonthChange(monthOf(target));
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, date: string) => {
    const deltas: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    };
    const delta = deltas[event.key];
    if (delta === undefined) return;
    event.preventDefault();
    move(date, delta);
  };

  return (
    <div className={cx('w-full max-w-sm', className)}>
      <div className="mb-space-sm flex items-center justify-between">
        <button
          type="button"
          aria-label="Mês anterior"
          disabled={Boolean(minMonth && shiftMonth(month, -1) < minMonth)}
          onClick={() => {
            onMonthChange(shiftMonth(month, -1));
          }}
          className={cx(
            'flex h-10 w-10 items-center justify-center text-bronze disabled:opacity-40',
            focusRing,
          )}
        >
          <Icon as={ChevronLeft} />
        </button>
        <h3 aria-live="polite" className="font-heading-mobile text-body capitalize text-ink">
          {monthLabel(month)}
        </h3>
        <button
          type="button"
          aria-label="Próximo mês"
          disabled={Boolean(maxMonth && shiftMonth(month, 1) > maxMonth)}
          onClick={() => {
            onMonthChange(shiftMonth(month, 1));
          }}
          className={cx(
            'flex h-10 w-10 items-center justify-center text-bronze disabled:opacity-40',
            focusRing,
          )}
        >
          <Icon as={ChevronRight} />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center font-caption text-caption uppercase text-ink-muted">
        {WEEKDAY_SHORT.map((name) => (
          <span key={name} aria-hidden="true">
            {name}
          </span>
        ))}
      </div>
      <div role="group" aria-label={monthLabel(month)} className="mt-1 grid grid-cols-7 gap-1">
        {Array.from({ length: leading }, (_, i) => (
          <span key={`blank-${String(i)}`} role="presentation" />
        ))}
        {dates.map((date) => {
          const info = byDate.get(date);
          const enabled = info?.status === 'available';
          const selected = value === date;
          const holiday = info?.isHoliday ? `Feriado: ${info.holidayName ?? ''}`.trim() : null;
          const label = [
            dayMonthLabel(date),
            holiday,
            info ? STATUS_TEXT[info.status] : 'carregando',
            info?.hasDiscount ? 'com desconto' : null,
          ]
            .filter(Boolean)
            .join(', ');
          return (
            <button
              key={date}
              ref={(node) => {
                if (node) buttons.current.set(date, node);
                else buttons.current.delete(date);
              }}
              type="button"
              aria-label={label}
              aria-disabled={!enabled}
              aria-pressed={selected}
              title={holiday ?? undefined}
              tabIndex={date === rovingDate ? 0 : -1}
              onFocus={() => {
                setFocusDate(date);
              }}
              onKeyDown={(event) => {
                onKeyDown(event, date);
              }}
              onClick={() => {
                if (enabled) onSelect(date);
              }}
              className={cx(
                'relative flex h-10 items-center justify-center rounded-control border font-small text-small transition-colors',
                selected
                  ? 'border-bronze bg-bronze text-on-bronze'
                  : enabled
                    ? 'border-hairline bg-surface-raised text-ink hover:border-bronze'
                    : 'cursor-not-allowed border-transparent text-ink-muted opacity-50',
                focusRing,
              )}
            >
              {Number(date.slice(8))}
              {holiday ? (
                <span
                  aria-hidden="true"
                  className="absolute bottom-1 h-1 w-1 rounded-full bg-champagne"
                />
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
