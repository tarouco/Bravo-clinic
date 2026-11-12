import { useState } from 'react';
import type { PublicCell } from '@bravo/core';
import { cx, focusRing } from '../ui/cx';

export type PeriodId = 'manha' | 'tarde' | 'noite';

export interface DayPeriod {
  id: PeriodId;
  label: string;
  cells: PublicCell[];
  /** Cells of the period a booking can start at. */
  freeCount: number;
}

const NOON = 12 * 60;
const EVENING = 18 * 60;

const PERIODS: readonly { id: PeriodId; label: string }[] = [
  { id: 'manha', label: 'Manhã' },
  { id: 'tarde', label: 'Tarde' },
  { id: 'noite', label: 'Noite' },
];

/** Manhã ends at 12:00 and Tarde at 18:00; a time belongs to the period it starts in. */
export function periodOf(minute: number): PeriodId {
  if (minute < NOON) return 'manha';
  return minute < EVENING ? 'tarde' : 'noite';
}

/** The day's cells grouped by period, in day order; periods without cells are left out. */
export function splitByPeriod(cells: readonly PublicCell[]): DayPeriod[] {
  return PERIODS.map(({ id, label }) => {
    const own = cells.filter((cell) => periodOf(cell.startMinute) === id);
    return { id, label, cells: own, freeCount: own.filter((cell) => cell.available).length };
  }).filter((period) => period.cells.length > 0);
}

/**
 * The period on screen: the one the person picked, else the one of the chosen start (a start that
 * came from the URL), else the first with a free time.
 */
export function useDayPeriods(cells: readonly PublicCell[], startMinute: number | null) {
  const [picked, setPicked] = useState<PeriodId | null>(null);
  const periods = splitByPeriod(cells);
  const active =
    periods.find((period) => period.id === picked) ??
    periods.find((period) => startMinute !== null && period.id === periodOf(startMinute)) ??
    periods.find((period) => period.freeCount > 0) ??
    periods[0];
  return { periods, active, pickPeriod: setPicked };
}

/** "4 livres" under the period name; a full period says "Sem horários". */
export function freeLabel(count: number): string {
  if (count === 0) return 'Sem horários';
  return count === 1 ? '1 livre' : `${String(count)} livres`;
}

export interface PeriodPickerProps {
  periods: readonly DayPeriod[];
  activeId: PeriodId | undefined;
  onChange: (id: PeriodId) => void;
  className?: string;
}

/**
 * Manhã / Tarde / Noite over the start times, each with its count of free times. Same sunken track
 * and raised pearl pill as `Tabs`, so it reads as a level above the time chips.
 */
export function PeriodPicker({ periods, activeId, onChange, className }: PeriodPickerProps) {
  return (
    <div
      role="group"
      aria-label="Período"
      className={cx('flex gap-1 rounded-pill bg-surface-deboss p-1 shadow-deboss', className)}
    >
      {periods.map((period) => {
        const selected = period.id === activeId;
        return (
          <button
            key={period.id}
            type="button"
            aria-pressed={selected}
            aria-label={`${period.label}, ${freeLabel(period.freeCount)}`}
            onClick={() => {
              onChange(period.id);
            }}
            className={cx(
              'flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-pill px-space-sm py-1.5 transition-colors',
              selected
                ? 'bg-surface-raised text-ink shadow-[var(--lift-1),var(--rim)]'
                : 'text-ink-muted hover:bg-glass-hover hover:text-ink',
              focusRing,
            )}
          >
            <span className={cx('font-small text-small', selected && 'font-semibold')}>
              {period.label}
            </span>
            <span className="font-caption text-caption">{freeLabel(period.freeCount)}</span>
          </button>
        );
      })}
    </div>
  );
}
