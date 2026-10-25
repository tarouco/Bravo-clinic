import { localDayRangeUtc, type BookingStatus, type LocalDate } from '@bravo/core';

/** Height of one slot row, in px; an event of 150 min on a 30-min grid is 5 rows tall. */
export const SLOT_ROW_PX = 28;

export type ScheduleTone = 'confirmed' | 'pending' | 'neutral' | 'block' | 'attention';

/** One booking or block on the schedule views (admin Gestão de Reservas, tenant Agenda). */
export interface ScheduleEvent {
  id: string;
  kind: 'booking' | 'block';
  startsAt: string;
  endsAt: string;
  /** Cleanup runs from `endsAt` until this instant (bookings only). */
  cleanupUntil?: string | null;
  /** Visible label: "Camila · Sala Principal" for a booking, the tag for a block. */
  title: string;
  tone?: ScheduleTone;
  onClick?: () => void;
}

/** A holiday or closed-day marker for one date. */
export interface DayMarker {
  date: LocalDate;
  label: string;
}

/** A translucent band over a date's time range (e.g. category price bands). */
export interface OverlayMarker {
  date: LocalDate;
  startMinute: number;
  endMinute: number;
  label: string;
}

export interface FreeSlot {
  date: LocalDate;
  startMinute: number;
  endMinute: number;
}

export interface DateRange {
  from: LocalDate;
  to: LocalDate;
}

export interface NavigateEvent extends DateRange {
  /** The new anchor date (any date inside the range). */
  date: LocalDate;
}

/** Event colors by booking status (confirmed/paid solid, holding pending, the rest muted). */
export function toneOfStatus(status: BookingStatus): ScheduleTone {
  switch (status) {
    case 'confirmed':
    case 'paid':
      return 'confirmed';
    case 'awaiting_payment':
    case 'pre_reserved':
    case 'held_for_renewal':
      return 'pending';
    case 'no_show':
    case 'cancelled_by_tenant':
    case 'cancelled_nonpayment':
    case 'cancelled_by_clinic':
      return 'attention';
    default:
      return 'neutral';
  }
}

export const TONE_CLASSES: Record<ScheduleTone, string> = {
  confirmed: 'border-bronze bg-bronze text-on-bronze',
  pending: 'border-champagne bg-champagne-soft text-on-champagne',
  neutral: 'border-hairline bg-surface-stone text-ink',
  block: 'border-border bg-surface-dim text-ink',
  attention: 'border-error bg-error-container text-on-error-container',
};

/** An event clipped to one date, in minutes of that day, with its side-by-side lane. */
export interface DayEvent {
  event: ScheduleEvent;
  startMinute: number;
  endMinute: number;
  /** Cleanup end in minutes of the day (clipped), or null. */
  cleanupEndMinute: number | null;
  lane: number;
  lanes: number;
}

function minutesOnDate(iso: string, dayStartMs: number): number {
  return Math.round((new Date(iso).getTime() - dayStartMs) / 60000);
}

/**
 * The events that touch `date`, clipped to the day, with lanes so overlapping events (different
 * rooms at the same time) sit side by side.
 */
export function layoutDay(
  events: readonly ScheduleEvent[],
  date: LocalDate,
  showCleanup: boolean,
): DayEvent[] {
  const dayStartMs = localDayRangeUtc(date).start.getTime();
  const items = events
    .map((event) => {
      const startMinute = Math.max(0, minutesOnDate(event.startsAt, dayStartMs));
      const endMinute = Math.min(1440, minutesOnDate(event.endsAt, dayStartMs));
      const cleanup =
        showCleanup && event.cleanupUntil
          ? Math.min(1440, minutesOnDate(event.cleanupUntil, dayStartMs))
          : null;
      return {
        event,
        startMinute,
        endMinute,
        cleanupEndMinute: cleanup !== null && cleanup > endMinute ? cleanup : null,
        lane: 0,
        lanes: 1,
      };
    })
    .filter((item) => item.endMinute > item.startMinute && item.startMinute < 1440)
    .sort((a, b) => a.startMinute - b.startMinute || b.endMinute - a.endMinute);

  // Greedy lane assignment inside clusters of transitively overlapping events.
  let cluster: DayEvent[] = [];
  let clusterEnd = -1;
  const laneEnds: number[] = [];
  const closeCluster = () => {
    for (const item of cluster) item.lanes = laneEnds.length;
    cluster = [];
    laneEnds.length = 0;
  };
  for (const item of items) {
    const occupiedUntil = Math.max(item.endMinute, item.cleanupEndMinute ?? 0);
    if (item.startMinute >= clusterEnd) {
      closeCluster();
      clusterEnd = -1;
    }
    let lane = laneEnds.findIndex((end) => end <= item.startMinute);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = occupiedUntil;
    item.lane = lane;
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, occupiedUntil);
  }
  closeCluster();
  return items;
}

/** `[start, end)` intervals of the date that are not free for a new booking. */
export function busyIntervals(dayEvents: readonly DayEvent[]): [number, number][] {
  return dayEvents.map((d) => [d.startMinute, d.cleanupEndMinute ?? d.endMinute]);
}
