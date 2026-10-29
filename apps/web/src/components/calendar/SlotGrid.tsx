import { formatBRL, minuteToHHMM, type AvailabilityDay, type PublicCell } from '@bravo/core';
import { formatDuration, formatMinuteRange } from '../../lib/format';
import { cx, focusRing } from '../ui/cx';

export interface SlotSelection {
  startMinute: number | null;
  endMinute: number | null;
}

export type BlockOption = AvailabilityDay['blockOptions'][number];

export interface SlotGridProps {
  cells: readonly PublicCell[];
  slotMinutes: number;
  /** Shortest bookable duration; the first duration offered. */
  minBookingMinutes: number;
  /** Chosen start and end; `endMinute` stays null until a duration is picked. */
  value: SlotSelection;
  onChange: (next: SlotSelection) => void;
  blockOptions?: readonly BlockOption[];
  selectedBlockId?: string | null;
  onSelectBlock?: (option: BlockOption) => void;
  className?: string;
}

/** "−10%" with the typographic minus sign (NUC-202). */
export const discountLabel = (percent: number): string => `−${String(percent)}%`;

/** Durations from the minimum up to `maxEndMinute` in slot steps (NUC-99). */
export function durationOptions(
  cell: PublicCell,
  slotMinutes: number,
  minBookingMinutes: number,
): number[] {
  if (cell.maxEndMinute === null) return [];
  const longest = cell.maxEndMinute - cell.startMinute;
  const options: number[] = [];
  for (let minutes = minBookingMinutes; minutes <= longest; minutes += slotMinutes) {
    options.push(minutes);
  }
  return options;
}

/**
 * Day grid of 40 px slots: pick a start among the startable cells, then a duration. Unavailable
 * cells are `aria-disabled`; selected cells fill with emerald; a cell with a slot discount shows
 * "−n%".
 */
export function SlotGrid({
  cells,
  slotMinutes,
  minBookingMinutes,
  value,
  onChange,
  blockOptions = [],
  selectedBlockId = null,
  onSelectBlock,
  className,
}: SlotGridProps) {
  const startCell = cells.find((cell) => cell.startMinute === value.startMinute);
  const durations = startCell ? durationOptions(startCell, slotMinutes, minBookingMinutes) : [];

  const isSelected = (minute: number) =>
    value.startMinute !== null &&
    minute >= value.startMinute &&
    minute < (value.endMinute ?? value.startMinute + slotMinutes);

  if (cells.length === 0 && blockOptions.length === 0) {
    return <p className="font-small text-small text-ink-muted">Sem horários neste dia.</p>;
  }

  return (
    <div className={cx('space-y-space-md', className)}>
      <ul aria-label="Horários de início" className="grid grid-cols-3 gap-space-xs sm:grid-cols-4">
        {cells.map((cell) => {
          const selected = isSelected(cell.startMinute);
          return (
            <li key={cell.startMinute}>
              <button
                type="button"
                aria-disabled={!cell.available}
                aria-pressed={cell.available ? selected : undefined}
                onClick={() => {
                  if (!cell.available) return;
                  onChange({ startMinute: cell.startMinute, endMinute: null });
                }}
                className={cx(
                  // Open times are pearl chips (selected = emerald with the neon lit); taken ones sink.
                  cell.available
                    ? 'bv-chip w-full min-w-0 gap-space-xs px-space-sm font-small text-small'
                    : cx(
                        'flex h-10 w-full cursor-not-allowed items-center justify-center gap-space-xs rounded-pill bg-surface-deboss font-small text-small text-ink-muted line-through shadow-deboss',
                        focusRing,
                      ),
                )}
              >
                <span>{minuteToHHMM(cell.startMinute)}</span>
                {cell.available && cell.discountPercent !== undefined ? (
                  <span className="font-caption text-caption">
                    {discountLabel(cell.discountPercent)}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>

      {startCell && durations.length > 0 ? (
        <div role="group" aria-label="Duração" className="space-y-space-xs">
          <p className="font-small text-small text-ink-muted">
            Quanto tempo a partir das {minuteToHHMM(startCell.startMinute)}?
          </p>
          <div className="flex flex-wrap gap-space-xs">
            {durations.map((minutes) => {
              const endMinute = startCell.startMinute + minutes;
              const selected = value.endMinute === endMinute;
              return (
                <button
                  key={minutes}
                  type="button"
                  aria-pressed={selected}
                  title={`Até ${minuteToHHMM(endMinute)}`}
                  onClick={() => {
                    onChange({ startMinute: startCell.startMinute, endMinute });
                  }}
                  className={cx('bv-chip font-small text-small')}
                >
                  {formatDuration(minutes)}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {blockOptions.length > 0 ? (
        <div role="group" aria-label="Blocos fechados" className="space-y-space-xs">
          <p className="font-small text-small text-ink-muted">Ou reserve um bloco fechado:</p>
          <ul className="space-y-space-xs">
            {blockOptions.map((option) => {
              const selected = selectedBlockId === option.categoryId;
              return (
                <li key={option.categoryId}>
                  <button
                    type="button"
                    aria-disabled={!option.available}
                    aria-pressed={option.available ? selected : undefined}
                    onClick={() => {
                      if (option.available) onSelectBlock?.(option);
                    }}
                    className={cx(
                      'min-h-10 w-full justify-between gap-space-md px-space-md py-space-xs text-left font-small text-small',
                      option.available
                        ? 'bv-chip h-auto'
                        : cx(
                            'flex cursor-not-allowed items-center rounded-pill bg-surface-deboss text-ink-muted shadow-deboss',
                            focusRing,
                          ),
                    )}
                  >
                    <span>
                      {option.name} · {formatMinuteRange(option.startMinute, option.endMinute)}
                    </span>
                    <span>{formatBRL(option.priceCents)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
