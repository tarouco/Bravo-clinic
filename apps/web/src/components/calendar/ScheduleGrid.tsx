import { minuteToHHMM, utcToLocal, type LocalDate } from '@bravo/core';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { dayMonthLabel, WEEKDAY_SHORT } from '../../lib/calendar-dates';
import { formatMinuteRange } from '../../lib/format';
import { cx, focusRing } from '../ui/cx';
import { HoverCard, type HoverCardTriggerProps } from '../ui/HoverCard';
import {
  busyIntervals,
  layoutDay,
  SLOT_ROW_PX,
  TONE_CLASSES,
  type DayEvent,
  type DayMarker,
  type FreeSlot,
  type OverlayMarker,
  type ScheduleEvent,
} from './schedule';

export interface ScheduleGridProps {
  /** Visible dates, left to right (seven for a week, one for a day). */
  dates: readonly LocalDate[];
  today: LocalDate;
  events: readonly ScheduleEvent[];
  holidays?: readonly DayMarker[];
  closedDays?: readonly DayMarker[];
  /** Translucent bands over time ranges, drawn under the events. */
  markers?: readonly OverlayMarker[];
  /** Shade the cleanup minutes after each booking (hidden on the tenant Agenda). */
  showCleanup?: boolean;
  /** Visible time range in minutes of the day. */
  window?: { startMinute: number; endMinute: number };
  slotMinutes?: number;
  /** Rendered inside every free cell (e.g. a "+" action); makes free cells interactive. */
  renderFreeSlot?: (slot: FreeSlot) => ReactNode;
  /** Called after dragging (or clicking) over free cells of one day. */
  onRangeSelect?: (range: FreeSlot) => void;
  /** Content of the card shown while hovering or focusing an event; null for none. */
  renderEventCard?: (event: ScheduleEvent) => ReactNode;
  className?: string;
}

interface Drag {
  date: LocalDate;
  anchor: number;
  current: number;
}

const DEFAULT_WINDOW = { startMinute: 420, endMinute: 1440 };

function weekdayLabel(date: LocalDate): string {
  const [y = 0, m = 1, d = 1] = date.split('-').map(Number);
  const jsDay = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return WEEKDAY_SHORT[(jsDay + 6) % 7] ?? '';
}

export function ScheduleGrid({
  dates,
  today,
  events,
  holidays = [],
  closedDays = [],
  markers = [],
  showCleanup = true,
  window: visible = DEFAULT_WINDOW,
  slotMinutes = 30,
  renderFreeSlot,
  onRangeSelect,
  renderEventCard,
  className,
}: ScheduleGridProps) {
  const pxPerMinute = SLOT_ROW_PX / slotMinutes;
  const rows = Math.ceil((visible.endMinute - visible.startMinute) / slotMinutes);
  const interactive = Boolean(onRangeSelect ?? renderFreeSlot);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;
  const onRangeSelectRef = useRef(onRangeSelect);
  onRangeSelectRef.current = onRangeSelect;

  const layouts = new Map(dates.map((date) => [date, layoutDay(events, date, showCleanup)]));
  const busy = new Map(dates.map((date) => [date, busyIntervals(layouts.get(date) ?? [])]));
  const closedDates = new Set(closedDays.map((c) => c.date as string));

  const isFree = (date: LocalDate, start: number) =>
    interactive &&
    !closedDates.has(date) &&
    !(busy.get(date) ?? []).some(([from, to]) => start < to && start + slotMinutes > from);

  // The drag ends wherever the pointer is released.
  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) return;
    const finish = () => {
      const current = dragRef.current;
      setDrag(null);
      if (!current) return;
      const startMinute = Math.min(current.anchor, current.current);
      const endMinute = Math.max(current.anchor, current.current) + slotMinutes;
      onRangeSelectRef.current?.({ date: current.date, startMinute, endMinute });
    };
    document.addEventListener('pointerup', finish);
    return () => {
      document.removeEventListener('pointerup', finish);
    };
  }, [dragging, slotMinutes]);

  const extendDrag = (date: LocalDate, start: number) => {
    setDrag((current) => {
      if (!current || current.date !== date) return current;
      const from = Math.min(current.anchor, start);
      const to = Math.max(current.anchor, start);
      for (let m = from; m <= to; m += slotMinutes) if (!isFree(date, m)) return current;
      return { ...current, current: start };
    });
  };

  const hourLabels = Array.from({ length: rows }, (_, i) => visible.startMinute + i * slotMinutes)
    .filter((minute) => minute % 60 === 0)
    .map((minute) => ({ minute, top: (minute - visible.startMinute) * pxPerMinute }));

  const topOf = (minute: number) => (minute - visible.startMinute) * pxPerMinute;

  return (
    <div
      className={cx(
        'overflow-x-auto rounded-card border border-hairline bg-surface-raised',
        className,
      )}
    >
      <div
        className="grid min-w-[40rem]"
        style={{ gridTemplateColumns: `3.5rem repeat(${String(dates.length)}, minmax(0, 1fr))` }}
      >
        <div className="sticky top-0 z-20 border-b border-hairline bg-surface-stone" />
        {dates.map((date) => {
          const holiday = holidays.find((h) => h.date === date);
          const closed = closedDays.find((c) => c.date === date);
          return (
            <div
              key={date}
              className={cx(
                'sticky top-0 z-20 border-b border-l border-hairline px-space-xs py-space-xs text-center font-small text-small',
                date === today
                  ? 'bg-champagne-soft text-on-champagne'
                  : 'bg-surface-stone text-ink',
              )}
            >
              <span className="uppercase tracking-[0.08em]">{weekdayLabel(date)}</span>{' '}
              <span className="font-medium">{Number(date.slice(8))}</span>
              {holiday ? (
                <span className="block truncate font-caption text-caption text-bronze">
                  {holiday.label}
                </span>
              ) : null}
              {closed ? (
                <span className="block truncate font-caption text-caption text-error">
                  {closed.label}
                </span>
              ) : null}
            </div>
          );
        })}

        <div className="relative" style={{ height: rows * SLOT_ROW_PX }}>
          {hourLabels.map(({ minute, top }) => (
            <span
              key={minute}
              className="absolute right-space-xs -translate-y-1/2 font-caption text-caption text-ink-muted"
              style={{ top: Math.max(top, 8) }}
            >
              {minuteToHHMM(minute)}
            </span>
          ))}
        </div>

        {dates.map((date) => {
          const dayEvents = layouts.get(date) ?? [];
          const closed = closedDates.has(date);
          return (
            <div
              key={date}
              role="group"
              aria-label={`${weekdayLabel(date)}, ${dayMonthLabel(date)}`}
              data-date={date}
              className="relative border-l border-hairline"
              style={{ height: rows * SLOT_ROW_PX }}
            >
              {Array.from({ length: rows }, (_, i) => {
                const start = visible.startMinute + i * slotMinutes;
                const free = isFree(date, start);
                const inDrag =
                  drag?.date === date &&
                  start >= Math.min(drag.anchor, drag.current) &&
                  start <= Math.max(drag.anchor, drag.current);
                return (
                  <div
                    key={start}
                    data-slot={start}
                    onPointerDown={(event) => {
                      if (!free || event.button !== 0) return;
                      setDrag({ date, anchor: start, current: start });
                    }}
                    onPointerEnter={() => {
                      extendDrag(date, start);
                    }}
                    className={cx(
                      'group relative border-t',
                      (start - visible.startMinute) % 60 === 0
                        ? 'border-hairline'
                        : 'border-hairline/40',
                      free && 'cursor-pointer hover:bg-champagne-soft/50',
                      inDrag && 'bg-champagne-soft',
                    )}
                    style={{ height: SLOT_ROW_PX }}
                  >
                    {free
                      ? renderFreeSlot?.({
                          date,
                          startMinute: start,
                          endMinute: start + slotMinutes,
                        })
                      : null}
                  </div>
                );
              })}

              {markers
                .filter((m) => m.date === date)
                .map((m) => (
                  <div
                    key={`${m.label}-${String(m.startMinute)}`}
                    title={m.label}
                    className="pointer-events-none absolute inset-x-0 border-y border-champagne/60 bg-champagne/20"
                    style={{
                      top: topOf(Math.max(m.startMinute, visible.startMinute)),
                      height:
                        (Math.min(m.endMinute, visible.endMinute) -
                          Math.max(m.startMinute, visible.startMinute)) *
                        pxPerMinute,
                    }}
                  >
                    <span className="px-space-xs font-caption text-caption text-bronze">
                      {m.label}
                    </span>
                  </div>
                ))}

              {closed ? (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 bg-surface-dim/60"
                />
              ) : null}

              <div className="pointer-events-none absolute inset-0">
                {dayEvents.map((item) => (
                  <EventBlock
                    key={item.event.id}
                    item={item}
                    visible={visible}
                    pxPerMinute={pxPerMinute}
                    card={renderEventCard?.(item.event) ?? null}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EventBlock({
  item,
  visible,
  pxPerMinute,
  card,
}: {
  item: DayEvent;
  visible: { startMinute: number; endMinute: number };
  pxPerMinute: number;
  card: ReactNode;
}) {
  const { event } = item;
  const start = Math.max(item.startMinute, visible.startMinute);
  const end = Math.min(item.endMinute, visible.endMinute);
  if (end <= start) return null;
  const left = `${String((item.lane / item.lanes) * 100)}%`;
  const width = `${String(100 / item.lanes)}%`;
  const style: CSSProperties = {
    top: (start - visible.startMinute) * pxPerMinute,
    height: (end - start) * pxPerMinute,
    left,
    width,
  };
  const cleanupEnd =
    item.cleanupEndMinute === null ? null : Math.min(item.cleanupEndMinute, visible.endMinute);
  const label = `${event.title}, ${formatMinuteRange(item.startMinute, item.endMinute)}`;
  const tone = TONE_CLASSES[event.tone ?? (event.kind === 'block' ? 'block' : 'confirmed')];

  const body = (props: Partial<HoverCardTriggerProps>) => (
    <button
      type="button"
      aria-label={label}
      data-event-id={event.id}
      data-kind={event.kind}
      onClick={event.onClick}
      className={cx(
        'pointer-events-auto absolute overflow-hidden rounded-control border px-space-xs py-0.5 text-left font-caption text-caption',
        tone,
        focusRing,
      )}
      style={style}
      {...props}
    >
      <span className="block truncate">{event.title}</span>
    </button>
  );

  return (
    <>
      {cleanupEnd !== null && cleanupEnd > end ? (
        <div
          title={`Limpeza ${formatMinuteRange(item.endMinute, item.cleanupEndMinute ?? cleanupEnd)}`}
          data-kind="cleanup"
          className="pointer-events-none absolute border-x border-dashed border-hairline bg-surface-dim/70"
          style={{
            top: (end - visible.startMinute) * pxPerMinute,
            height: (cleanupEnd - end) * pxPerMinute,
            left,
            width,
          }}
        />
      ) : null}
      {card ? (
        // The events layer ignores the pointer (free slots underneath stay clickable); the card
        // and its actions must take it back.
        <HoverCard
          label={event.title}
          trigger={(props) => body(props)}
          align="start"
          className="pointer-events-auto"
        >
          {card}
        </HoverCard>
      ) : (
        body({})
      )}
    </>
  );
}

/** Local date of an ISO instant, for callers that bucket events by day. */
export function localDateOf(iso: string): LocalDate {
  return utcToLocal(new Date(iso)).date;
}
