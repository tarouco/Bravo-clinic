import { diffDays, localToUtc, utcToLocal, type LocalDate } from '../time';
import type { REJECT_REASONS } from '../contracts/common';

export interface GridSettings {
  slotMinutes: number;
  minBookingMinutes: number;
  cleanupMinutes: number;
  minAdvanceMinutes: number;
  maxAdvanceDays: number;
}

/** An active occupancy. Booking: `occupiedUntil` = end + its frozen cleanup; block: = end. */
export interface Occupied {
  start: Date;
  end: Date;
  occupiedUntil: Date;
  kind: 'booking' | 'block';
  label?: string;
}

export type RejectReason = (typeof REJECT_REASONS)[number];

export interface TimeWindow {
  openMinute: number;
  closeMinute: number;
}

export interface SlotCell {
  startMinute: number;
  state: 'available' | 'unavailable';
  adminState: 'free' | 'booking' | 'cleanup' | 'block' | 'leftover' | 'closed' | 'past';
  startable: boolean;
  maxEndMinute: number | null;
}

const MS_PER_MINUTE = 60_000;

interface Span {
  start: number;
  end: number;
  until: number;
  kind: 'booking' | 'block';
}

interface DayContext {
  window: TimeWindow | null;
  spans: Span[];
  settings: GridSettings;
  earliestStartMs: number;
  tooFar: boolean;
  instant: (minute: number) => number;
}

function dayContext(args: {
  date: LocalDate;
  window: TimeWindow | null;
  occupied: Occupied[];
  settings: GridSettings;
  now: Date;
}): DayContext {
  const { date, settings, now } = args;
  const cache = new Map<number, number>();
  const instant = (minute: number): number => {
    let ms = cache.get(minute);
    if (ms === undefined) {
      ms = localToUtc(date, minute).getTime();
      cache.set(minute, ms);
    }
    return ms;
  };
  const spans = args.occupied
    .map((o) => ({
      start: o.start.getTime(),
      end: o.end.getTime(),
      until: o.occupiedUntil.getTime(),
      kind: o.kind,
    }))
    .sort((a, b) => a.start - b.start);
  return {
    window: args.window,
    spans,
    settings,
    earliestStartMs: now.getTime() + settings.minAdvanceMinutes * MS_PER_MINUTE,
    tooFar: diffDays(utcToLocal(now).date, date) > settings.maxAdvanceDays,
    instant,
  };
}

/**
 * Occupancy rule (architecture 7.4 rule 4). The candidate conflicts with `o` exactly when
 * `[S, E + cleanup)` overlaps `[o.start, o.occupiedUntil)`, the predicate of the
 * `room_occupancy` exclusion constraint; the three reasons only refine the message.
 */
function occupancyReason(
  spans: Span[],
  s: number,
  e: number,
  cleanupMs: number,
): RejectReason | null {
  for (const o of spans) {
    if (s < o.end && e > o.start)
      return o.kind === 'booking' ? 'overlaps_booking' : 'overlaps_block';
    if (s < o.until && s >= o.end) return 'in_cleanup';
    if (e + cleanupMs > o.start && e <= o.start) return 'no_cleanup_before_next';
  }
  return null;
}

function check(ctx: DayContext, startMinute: number, endMinute: number): RejectReason | null {
  const { window, settings } = ctx;
  if (window === null) return 'closed';
  if (startMinute < window.openMinute || endMinute > window.closeMinute) return 'outside_hours';
  if (startMinute % settings.slotMinutes !== 0 || endMinute % settings.slotMinutes !== 0) {
    return 'misaligned';
  }
  if (endMinute - startMinute < settings.minBookingMinutes) return 'too_short';
  if (ctx.instant(startMinute) <= ctx.earliestStartMs) return 'in_past';
  if (ctx.tooFar) return 'too_far';
  return occupancyReason(
    ctx.spans,
    ctx.instant(startMinute),
    ctx.instant(endMinute),
    settings.cleanupMinutes * MS_PER_MINUTE,
  );
}

/** Validates a candidate `[startMinute, endMinute)` on a local date (architecture 7.4). */
export function validateInterval(args: {
  date: LocalDate;
  startMinute: number;
  endMinute: number;
  window: TimeWindow | null;
  occupied: Occupied[];
  settings: GridSettings;
  now: Date;
}): { ok: true } | { ok: false; reason: RejectReason } {
  const reason = check(dayContext(args), args.startMinute, args.endMinute);
  return reason === null ? { ok: true } : { ok: false, reason };
}

/**
 * One cell per slot of the window. A cell is available when it lies inside at least one valid
 * interval of `minBookingMinutes`; free cells that fit none are `leftover` (unavailable, no error).
 * `maxEndMinute` is the largest valid end for a booking starting at the cell.
 */
export function generateSlotGrid(args: {
  date: LocalDate;
  window: TimeWindow | null;
  occupied: Occupied[];
  settings: GridSettings;
  now: Date;
}): SlotCell[] {
  const ctx = dayContext(args);
  const { window, settings, spans } = ctx;
  if (window === null) return [];
  const slot = settings.slotMinutes;
  const min = settings.minBookingMinutes;
  const starts: number[] = [];
  for (let s = window.openMinute; s + slot <= window.closeMinute; s += slot) starts.push(s);
  const startable = new Map(starts.map((s) => [s, check(ctx, s, s + min) === null]));

  return starts.map((s) => {
    let maxEndMinute: number | null = null;
    if (startable.get(s) === true) {
      maxEndMinute = s + min;
      while (
        maxEndMinute + slot <= window.closeMinute &&
        check(ctx, s, maxEndMinute + slot) === null
      ) {
        maxEndMinute += slot;
      }
    }
    const available = starts.some(
      (first) => first <= s && s + slot <= first + min && startable.get(first) === true,
    );
    const cellStart = ctx.instant(s);
    const cellEnd = ctx.instant(s + slot);
    const touches = (from: number, to: number) => cellStart < to && cellEnd > from;
    let adminState: SlotCell['adminState'];
    if (spans.some((o) => o.kind === 'booking' && touches(o.start, o.end))) {
      adminState = 'booking';
    } else if (spans.some((o) => o.kind === 'block' && touches(o.start, o.end))) {
      adminState = 'block';
    } else if (spans.some((o) => touches(o.end, o.until))) {
      adminState = 'cleanup';
    } else if (cellStart <= ctx.earliestStartMs) {
      adminState = 'past';
    } else if (ctx.tooFar) {
      adminState = 'closed';
    } else {
      adminState = available ? 'free' : 'leftover';
    }
    return {
      startMinute: s,
      state: adminState === 'free' ? 'available' : 'unavailable',
      adminState,
      startable: maxEndMinute !== null,
      maxEndMinute,
    };
  });
}

const REJECT_MESSAGES: Record<RejectReason, string> = {
  closed: 'Sala fechada nesta data',
  outside_hours: 'Fora do horário de funcionamento',
  misaligned: 'Horário fora da grade de horários',
  too_short: 'Duração abaixo do mínimo',
  in_past: 'Horário indisponível para reserva',
  too_far: 'Data além da antecedência máxima',
  overlaps_booking: 'Horário já reservado',
  in_cleanup: 'Sala em limpeza',
  overlaps_block: 'Horário bloqueado',
  no_cleanup_before_next: 'Termina sem o intervalo de limpeza antes da próxima reserva',
};

/** pt-BR text of a reject reason (NUC-17). */
export function rejectMessage(reason: RejectReason): string {
  return REJECT_MESSAGES[reason];
}

/**
 * Pairs of bookings of the same room that would overlap their cleanup if the cleanup became
 * `newCleanupMinutes`: `first.end + c > second.start`, with `first` starting earlier.
 */
export function findCleanupConflicts(
  bookings: { id: string; roomId: string; start: Date; end: Date }[],
  newCleanupMinutes: number,
): { firstId: string; secondId: string }[] {
  const cleanupMs = newCleanupMinutes * MS_PER_MINUTE;
  const sorted = [...bookings].sort(
    (a, b) => a.roomId.localeCompare(b.roomId) || a.start.getTime() - b.start.getTime(),
  );
  const pairs: { firstId: string; secondId: string }[] = [];
  sorted.forEach((first, i) => {
    const busyUntil = first.end.getTime() + cleanupMs;
    for (const second of sorted.slice(i + 1)) {
      if (second.roomId !== first.roomId || second.start.getTime() >= busyUntil) break;
      pairs.push({ firstId: first.id, secondId: second.id });
    }
  });
  return pairs;
}

/** Occupancy of a booking: `[start, end + cleanup)`. */
export function occupiedFromBooking(b: {
  start: Date;
  end: Date;
  cleanupMinutes: number;
}): Occupied {
  return {
    start: b.start,
    end: b.end,
    occupiedUntil: new Date(b.end.getTime() + b.cleanupMinutes * MS_PER_MINUTE),
    kind: 'booking',
  };
}

/** Occupancy of a manual block: exactly `[start, end)`, no cleanup (NUC-59). */
export function occupiedFromBlock(b: { start: Date; end: Date; tag?: string }): Occupied {
  const occupied: Occupied = { start: b.start, end: b.end, occupiedUntil: b.end, kind: 'block' };
  if (b.tag !== undefined) occupied.label = b.tag;
  return occupied;
}
