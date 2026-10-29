import type { BusinessHoursUpdate } from '@bravo/core';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Button } from '../../components/ui/Button';
import { cx, focusRing } from '../../components/ui/cx';
import { formatHHMM, minuteFromPointer } from './time';
import { TimeField } from './TimeField';

export type HoursRow = BusinessHoursUpdate['rows'][number];
type DayType = HoursRow['dayType'];
type Edge = 'open' | 'close';

export const DAY_ORDER: readonly DayType[] = [
  'mon',
  'tue',
  'wed',
  'thu',
  'fri',
  'sat',
  'sun',
  'holiday',
];

const DAY_LABELS: Record<DayType, { short: string; name: string }> = {
  mon: { short: 'Seg', name: 'segunda' },
  tue: { short: 'Ter', name: 'terça' },
  wed: { short: 'Qua', name: 'quarta' },
  thu: { short: 'Qui', name: 'quinta' },
  fri: { short: 'Sex', name: 'sexta' },
  sat: { short: 'Sáb', name: 'sábado' },
  sun: { short: 'Dom', name: 'domingo' },
  holiday: { short: 'Feriados', name: 'feriados' },
};

/** Height of one hour on the week grid, in px. */
export const HOUR_PX = 24;
const PX_PER_MINUTE = HOUR_PX / 60;
const HANDLE_PX = 10;

export interface WeekHoursEditorProps {
  /** The 8 rows: Monday to Sunday, then holidays. */
  rows: readonly HoursRow[];
  slotMinutes: number;
  onChange: (rows: HoursRow[]) => void;
  /** Drawn inside each day column over the open band (category price bands). */
  renderOverlay?: (args: { row: HoursRow; pxPerMinute: number }) => ReactNode;
  disabled?: boolean;
}

interface Drag {
  day: DayType;
  edge: Edge;
  column: HTMLElement;
}

/** Applies a new open or close minute to a row, keeping at least one slot between the two. */
function withEdge(row: HoursRow, edge: Edge, minute: number, slot: number): HoursRow {
  if (edge === 'open') {
    return { ...row, openMinute: Math.min(Math.max(0, minute), row.closeMinute - slot) };
  }
  return { ...row, closeMinute: Math.max(Math.min(1440, minute), row.openMinute + slot) };
}

/**
 * Business hours of the week (NUC-40): Monday to Sunday plus holidays, each with a closed flag,
 * typed open/close inputs and drag handles that snap to the slot size (NUC-42). The two shortcuts
 * copy a day's hours to the others.
 */
export function WeekHoursEditor({
  rows,
  slotMinutes,
  onChange,
  renderOverlay,
  disabled = false,
}: WeekHoursEditorProps) {
  const byDay = new Map(rows.map((row) => [row.dayType, row]));
  const ordered = DAY_ORDER.map((day) => byDay.get(day)).filter(
    (row): row is HoursRow => row !== undefined,
  );

  const [drag, setDrag] = useState<Drag | null>(null);
  const live = useRef({ rows, onChange, slotMinutes });
  live.current = { rows, onChange, slotMinutes };

  const update = (day: DayType, change: (row: HoursRow) => HoursRow) => {
    onChange(rows.map((row) => (row.dayType === day ? change(row) : row)));
  };

  const copyTo = (from: DayType, targets: readonly DayType[]) => {
    const source = byDay.get(from);
    if (!source) return;
    onChange(
      rows.map((row) =>
        targets.includes(row.dayType)
          ? {
              ...row,
              isClosed: source.isClosed,
              openMinute: source.openMinute,
              closeMinute: source.closeMinute,
            }
          : row,
      ),
    );
  };

  const dragging = drag !== null;
  useEffect(() => {
    if (!drag) return;
    const move = (event: PointerEvent) => {
      const { rows: current, onChange: emit, slotMinutes: slot } = live.current;
      const rect = drag.column.getBoundingClientRect();
      const minute = minuteFromPointer(event.clientY, rect, slot);
      emit(
        current.map((row) =>
          row.dayType === drag.day ? withEdge(row, drag.edge, minute, slot) : row,
        ),
      );
    };
    const stop = () => {
      setDrag(null);
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', stop);
    return () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', stop);
    };
    // The drag target is fixed while `dragging`; rows and callbacks are read from `live`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging]);

  const onHandleKey = (event: KeyboardEvent, row: HoursRow, edge: Edge) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const step = event.key === 'ArrowDown' ? slotMinutes : -slotMinutes;
    const current = edge === 'open' ? row.openMinute : row.closeMinute;
    update(row.dayType, (r) => withEdge(r, edge, current + step, slotMinutes));
  };

  const hourLines = {
    backgroundImage:
      'repeating-linear-gradient(to bottom, transparent 0, transparent ' +
      `${String(HOUR_PX - 1)}px, rgb(var(--c-hairline) / 0.6) ${String(HOUR_PX - 1)}px, rgb(var(--c-hairline) / 0.6) ${String(HOUR_PX)}px)`,
  };

  return (
    <div className="space-y-space-md">
      <div className="flex flex-wrap gap-space-sm">
        <Button
          variant="secondary"
          size="sm"
          disabled={disabled}
          onClick={() => {
            copyTo('mon', ['tue', 'wed', 'thu', 'fri']);
          }}
        >
          Aplicar a seg–sex
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={disabled}
          onClick={() => {
            copyTo('sat', ['sun', 'holiday']);
          }}
        >
          Aplicar a sáb, dom e feriados
        </Button>
      </div>

      <div className="overflow-x-auto rounded-lg bg-surface-raised shadow-card">
        <div
          className="grid min-w-[56rem]"
          style={{ gridTemplateColumns: '3.5rem repeat(8, minmax(6.5rem, 1fr))' }}
        >
          <div className="border-b border-hairline" />
          {ordered.map((row) => {
            const label = DAY_LABELS[row.dayType];
            return (
              <div
                key={row.dayType}
                className="space-y-space-xs border-b border-l border-hairline p-space-xs"
              >
                <p className="text-center font-eyebrow text-eyebrow uppercase text-ink-muted">
                  {label.short}
                </p>
                <label className="flex items-center justify-center gap-space-xs font-caption text-caption text-ink">
                  <input
                    type="checkbox"
                    checked={row.isClosed}
                    disabled={disabled}
                    onChange={(event) => {
                      update(row.dayType, (r) => ({ ...r, isClosed: event.target.checked }));
                    }}
                    className={cx('h-4 w-4 accent-emerald', focusRing)}
                  />
                  <span>
                    <span className="sr-only">{label.name}: </span>Fechado
                  </span>
                </label>
                <TimeField
                  compact
                  label={`Abertura ${label.name}`}
                  value={row.openMinute}
                  disabled={disabled || row.isClosed}
                  validate={(minute) =>
                    minute % slotMinutes !== 0
                      ? `Use múltiplos de ${String(slotMinutes)} min.`
                      : minute >= row.closeMinute
                        ? 'A abertura precisa ser antes do fechamento.'
                        : null
                  }
                  onCommit={(minute) => {
                    update(row.dayType, (r) => ({ ...r, openMinute: minute }));
                  }}
                />
                <TimeField
                  compact
                  label={`Fechamento ${label.name}`}
                  value={row.closeMinute}
                  disabled={disabled || row.isClosed}
                  validate={(minute) =>
                    minute % slotMinutes !== 0
                      ? `Use múltiplos de ${String(slotMinutes)} min.`
                      : minute <= row.openMinute
                        ? 'O fechamento precisa ser depois da abertura.'
                        : null
                  }
                  onCommit={(minute) => {
                    update(row.dayType, (r) => ({ ...r, closeMinute: minute }));
                  }}
                />
              </div>
            );
          })}

          <div className="relative" style={{ height: 24 * HOUR_PX }}>
            {Array.from({ length: 12 }, (_, i) => i * 2).map((hour) => (
              <span
                key={hour}
                className="absolute right-space-xs font-caption text-caption text-ink-muted"
                style={{ top: Math.max(hour * HOUR_PX - 8, 0) }}
              >
                {formatHHMM(hour * 60)}
              </span>
            ))}
          </div>

          {ordered.map((row) => (
            <div
              key={row.dayType}
              data-day={row.dayType}
              className="relative border-l border-hairline"
              style={{ height: 24 * HOUR_PX, ...hourLines }}
            >
              {row.isClosed ? (
                <div className="absolute inset-0 flex items-center justify-center bg-surface-deboss/80 font-caption text-caption text-ink-muted">
                  Fechado
                </div>
              ) : (
                <div
                  className="absolute inset-x-0 border-y-2 border-accent bg-emerald/[0.08]"
                  style={{
                    top: row.openMinute * PX_PER_MINUTE,
                    height: (row.closeMinute - row.openMinute) * PX_PER_MINUTE,
                  }}
                >
                  <span className="px-space-xs font-caption text-caption text-accent">
                    {formatHHMM(row.openMinute)}–{formatHHMM(row.closeMinute)}
                  </span>
                </div>
              )}
              {!row.isClosed && renderOverlay
                ? renderOverlay({ row, pxPerMinute: PX_PER_MINUTE })
                : null}
              {!row.isClosed
                ? (['open', 'close'] as const).map((edge) => {
                    const minute = edge === 'open' ? row.openMinute : row.closeMinute;
                    const day = DAY_LABELS[row.dayType].name;
                    return (
                      <div
                        key={edge}
                        role="slider"
                        tabIndex={disabled ? -1 : 0}
                        aria-orientation="vertical"
                        aria-label={`Ajustar ${edge === 'open' ? 'abertura' : 'fechamento'} (${day})`}
                        aria-valuemin={edge === 'open' ? 0 : row.openMinute + slotMinutes}
                        aria-valuemax={edge === 'open' ? row.closeMinute - slotMinutes : 1440}
                        aria-valuenow={minute}
                        aria-valuetext={formatHHMM(minute)}
                        onKeyDown={(event) => {
                          onHandleKey(event, row, edge);
                        }}
                        onPointerDown={(event) => {
                          if (disabled || event.button !== 0) return;
                          const column = event.currentTarget.parentElement;
                          if (!column) return;
                          event.preventDefault();
                          setDrag({ day: row.dayType, edge, column });
                        }}
                        className={cx(
                          'absolute inset-x-0 z-10 cursor-ns-resize touch-none rounded-pill bg-emerald hover:shadow-neon-glow focus-visible:shadow-neon-glow',
                          focusRing,
                        )}
                        style={{
                          height: HANDLE_PX,
                          top: minute * PX_PER_MINUTE - (edge === 'open' ? 0 : HANDLE_PX),
                        }}
                      />
                    );
                  })
                : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
