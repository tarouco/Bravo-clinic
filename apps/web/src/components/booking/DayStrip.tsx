import { weekdayOf, type AvailabilityMonth } from '@bravo/core';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { cx } from '../ui/cx';
import { IconButton } from '../ui/IconButton';
import {
  datesOfMonth,
  dayMonthLabel,
  monthLabel,
  monthOf,
  shiftMonth,
  WEEKDAY_SHORT,
} from '../../lib/calendar-dates';

type MonthDay = AvailabilityMonth['days'][number];

export interface DayStripProps {
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
  /** Days before this date are left out of the strip (`YYYY-MM-DD`). */
  hideBefore?: string;
  className?: string;
}

const STATUS_TEXT: Record<MonthDay['status'], string> = {
  available: 'disponível',
  full: 'sem horários',
  closed: 'fechado',
  past: 'data passada',
  out_of_range: 'fora do período de reservas',
};

/**
 * Date picker of the app (guias/AppScreens.md): the days of a month in the `bv-week` strip, the
 * chosen one emerald and lit, months changed with the pearl arrows. Arrow keys move between days.
 */
export function DayStrip({
  month,
  days,
  value,
  onSelect,
  onMonthChange,
  minMonth,
  maxMonth,
  hideBefore,
  className,
}: DayStripProps) {
  const byDate = new Map(days.map((day) => [day.date as string, day]));
  const dates = datesOfMonth(month).filter((date) => !hideBefore || date >= hideBefore);
  const selectable = (date: string) => byDate.get(date)?.status === 'available';
  const enabledDates: string[] = dates.filter(selectable);

  const [focusDate, setFocusDate] = useState<string | null>(null);
  const strip = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());

  const rovingDate =
    (focusDate && enabledDates.includes(focusDate) ? focusDate : null) ??
    (value && enabledDates.includes(value) ? value : null) ??
    enabledDates[0];

  // Brings the chosen day (or the first open one) into view when the month or the data changes.
  const anchor = value && monthOf(value) === month ? value : enabledDates[0];
  useEffect(() => {
    const node = anchor ? buttons.current.get(anchor) : undefined;
    const container = strip.current;
    if (!node || !container) return;
    container.scrollLeft = node.offsetLeft - container.clientWidth / 2 + node.clientWidth / 2;
  }, [anchor, month]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, date: string) => {
    const delta = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
    if (delta === 0) return;
    event.preventDefault();
    const target = enabledDates[enabledDates.indexOf(date) + delta];
    if (!target) return;
    setFocusDate(target);
    buttons.current.get(target)?.focus();
  };

  const label = monthLabel(month);

  return (
    <div className={cx('space-y-space-sm', className)}>
      <div className="flex items-center justify-between gap-space-sm">
        <IconButton
          icon={ChevronLeft}
          label="Mês anterior"
          size="sm"
          disabled={Boolean(minMonth && shiftMonth(month, -1) < minMonth)}
          onClick={() => {
            onMonthChange(shiftMonth(month, -1));
          }}
        />
        <h3
          aria-live="polite"
          className="font-heading-mobile text-heading-mobile text-ink first-letter:uppercase"
        >
          {label}
        </h3>
        <IconButton
          icon={ChevronRight}
          label="Próximo mês"
          size="sm"
          disabled={Boolean(maxMonth && shiftMonth(month, 1) > maxMonth)}
          onClick={() => {
            onMonthChange(shiftMonth(month, 1));
          }}
        />
      </div>

      {dates.length === 0 ? (
        <p className="font-small text-small text-ink-muted">Sem datas neste mês.</p>
      ) : (
        <div
          ref={strip}
          role="group"
          aria-label={label}
          className="bv-week justify-start gap-space-xs overflow-x-auto overscroll-x-contain"
        >
          {dates.map((date) => {
            const info = byDate.get(date);
            const enabled = info?.status === 'available';
            const holiday = info?.isHoliday ? `Feriado: ${info.holidayName ?? ''}`.trim() : null;
            const name = [
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
                aria-label={name}
                aria-pressed={value === date}
                disabled={!enabled}
                title={holiday ?? undefined}
                tabIndex={date === rovingDate ? 0 : -1}
                onFocus={() => {
                  setFocusDate(date);
                }}
                onKeyDown={(event) => {
                  onKeyDown(event, date);
                }}
                onClick={() => {
                  onSelect(date);
                }}
                className="bv-day shrink-0 disabled:cursor-not-allowed disabled:opacity-[0.42]"
              >
                {WEEKDAY_SHORT[weekdayOf(date) - 1]}
                <b>{Number(date.slice(8))}</b>
                {holiday || info?.hasDiscount ? (
                  <span
                    aria-hidden="true"
                    className={cx(
                      'absolute bottom-1.5 h-1 w-1 rounded-full',
                      holiday ? 'bg-ink-muted' : 'bg-accent',
                    )}
                  />
                ) : null}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
