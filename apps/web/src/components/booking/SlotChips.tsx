import { formatBRL, minuteToHHMM, type PublicCell } from '@bravo/core';
import {
  discountLabel,
  durationOptions,
  type BlockOption,
  type SlotSelection,
} from '../calendar/SlotGrid';
import { Chip, ChipGroup } from '../ui/Chip';
import { cx } from '../ui/cx';
import { formatDuration, formatMinuteRange } from '../../lib/format';

export interface SlotChipsProps {
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

/** Chips have no disabled look of their own: 42%, flat, no neon (DESIGN-v3.md). */
const offChip = 'disabled:cursor-not-allowed disabled:opacity-[0.42] disabled:shadow-none';

/**
 * Time slots of the app as chips (guias/Chip.md): a start time, then a duration, or a closed
 * block. The chosen interval stays emerald and lit; taken times are flat and struck through.
 */
export function SlotChips({
  cells,
  slotMinutes,
  minBookingMinutes,
  value,
  onChange,
  blockOptions = [],
  selectedBlockId = null,
  onSelectBlock,
  className,
}: SlotChipsProps) {
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
    <div className={cx('space-y-space-lg', className)}>
      <ul aria-label="Horários de início" className="flex flex-wrap gap-space-sm">
        {cells.map((cell) => (
          <li key={cell.startMinute}>
            <Chip
              selected={cell.available && isSelected(cell.startMinute)}
              disabled={!cell.available}
              onClick={() => {
                onChange({ startMinute: cell.startMinute, endMinute: null });
              }}
              className={cx('gap-space-xs', offChip, !cell.available && 'line-through')}
            >
              <span>{minuteToHHMM(cell.startMinute)}</span>
              {cell.available && cell.discountPercent !== undefined ? (
                <span className="font-caption text-caption">
                  {discountLabel(cell.discountPercent)}
                </span>
              ) : null}
            </Chip>
          </li>
        ))}
      </ul>

      {startCell && durations.length > 0 ? (
        <div className="space-y-space-sm">
          <p className="font-small text-small text-ink-muted">
            Quanto tempo a partir das {minuteToHHMM(startCell.startMinute)}?
          </p>
          <ChipGroup
            label="Duração"
            value={
              value.endMinute === null ? null : String(value.endMinute - startCell.startMinute)
            }
            onChange={(minutes) => {
              onChange({
                startMinute: startCell.startMinute,
                endMinute: startCell.startMinute + Number(minutes),
              });
            }}
            options={durations.map((minutes) => ({
              value: String(minutes),
              label: formatDuration(minutes),
            }))}
            className="gap-space-sm"
          />
        </div>
      ) : null}

      {blockOptions.length > 0 ? (
        <div role="group" aria-label="Blocos fechados" className="space-y-space-sm">
          <p className="font-small text-small text-ink-muted">Ou reserve um bloco fechado</p>
          <ul className="space-y-space-sm">
            {blockOptions.map((option) => (
              <li key={option.categoryId}>
                <Chip
                  selected={option.available && selectedBlockId === option.categoryId}
                  disabled={!option.available}
                  onClick={() => {
                    onSelectBlock?.(option);
                  }}
                  className={cx(
                    'h-auto min-h-12 w-full justify-between gap-space-md py-space-sm text-left',
                    offChip,
                  )}
                >
                  <span>
                    {option.name} · {formatMinuteRange(option.startMinute, option.endMinute)}
                  </span>
                  <span className="shrink-0">{formatBRL(option.priceCents)}</span>
                </Chip>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
