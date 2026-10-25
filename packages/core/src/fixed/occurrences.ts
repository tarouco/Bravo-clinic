import { assertCents, type Cents } from '../money';
import { addDays, localToUtc, utcToLocal, weekdayOf, type LocalDate } from '../time';
import type { ClosedDayRef } from '../calendar/day-type';
import { occupancyConflict, type Occupied, type TimeWindow } from '../slots/grid';

// Fixed-schedule packages (docs/architecture.md section 7.11, PRD 5.3.2).

export interface Occurrence {
  date: LocalDate;
  startsAt: Date;
  endsAt: Date;
}

const MS_PER_MINUTE = 60_000;

/**
 * Occurrences of a weekly pattern on the dates `[baseOn, baseOn + periodDays)`. Holidays keep
 * their occurrence (REC-90); occurrences starting before `notBefore` (now + min advance) are
 * dropped (REC-89); `calendar.max_advance_days` does not apply. `endMinute` 1440 ends at 00:00 of
 * the next local day.
 */
export function generateOccurrences(args: {
  baseOn: LocalDate;
  periodDays: number;
  weekdays: number[];
  startMinute: number;
  endMinute: number;
  notBefore?: Date;
}): Occurrence[] {
  const out: Occurrence[] = [];
  for (let day = 0; day < args.periodDays; day += 1) {
    const date = addDays(args.baseOn, day);
    if (!args.weekdays.includes(weekdayOf(date))) continue;
    const startsAt = localToUtc(date, args.startMinute);
    if (args.notBefore !== undefined && startsAt.getTime() < args.notBefore.getTime()) continue;
    out.push({ date, startsAt, endsAt: localToUtc(date, args.endMinute) });
  }
  return out;
}

/** Period price = price per occurrence × occurrences (22 × 28000 = 616000). */
export function fixedPeriodPriceCents(
  pricePerOccurrenceCents: Cents,
  occurrenceCount: number,
): Cents {
  return assertCents(pricePerOccurrenceCents * occurrenceCount);
}

/**
 * Occurrence count and price range of a period over the 7 possible start weekdays (REC-04):
 * Mon–Fri, 30 days, 28000 → 20..22 occurrences, 560000..616000.
 */
export function estimateFixedPeriod(args: {
  weekdays: number[];
  periodDays: number;
  pricePerOccurrenceCents: Cents;
}): { minCount: number; maxCount: number; minCents: Cents; maxCents: Cents } {
  const counts = [1, 2, 3, 4, 5, 6, 7].map((startWeekday) => {
    let count = 0;
    for (let day = 0; day < args.periodDays; day += 1) {
      if (args.weekdays.includes(((startWeekday - 1 + day) % 7) + 1)) count += 1;
    }
    return count;
  });
  const minCount = Math.min(...counts);
  const maxCount = Math.max(...counts);
  return {
    minCount,
    maxCount,
    minCents: fixedPeriodPriceCents(args.pricePerOccurrenceCents, minCount),
    maxCents: fixedPeriodPriceCents(args.pricePerOccurrenceCents, maxCount),
  };
}

export type OccurrenceConflictReason =
  | 'closed'
  | 'outside_hours'
  | 'overlaps_booking'
  | 'in_cleanup'
  | 'overlaps_block'
  | 'no_cleanup_before_next';

/**
 * Conflicting occurrences (REC-84, REC-85): a closed day of the clinic or of the room, no business
 * window (a date missing from `windows` counts as closed), an occurrence outside the window, or the
 * occupancy rule `[S, E + cleanup)` against `[o.start, o.occupiedUntil)` of bookings and blocks.
 */
export function findOccurrenceConflicts(
  occ: Occurrence[],
  ctx: {
    closedDays: ClosedDayRef[];
    roomId: string;
    occupied: Occupied[];
    cleanupMinutes: number;
    windows: Map<LocalDate, TimeWindow | null>;
  },
): { date: LocalDate; reason: OccurrenceConflictReason }[] {
  const conflicts: { date: LocalDate; reason: OccurrenceConflictReason }[] = [];
  for (const o of occ) {
    const closed = ctx.closedDays.some(
      (c) => c.date === o.date && (c.roomId === null || c.roomId === ctx.roomId),
    );
    const window = ctx.windows.get(o.date) ?? null;
    if (closed || window === null) {
      conflicts.push({ date: o.date, reason: 'closed' });
      continue;
    }
    const startMinute = utcToLocal(o.startsAt).minuteOfDay;
    const endMinute = startMinute + (o.endsAt.getTime() - o.startsAt.getTime()) / MS_PER_MINUTE;
    if (startMinute < window.openMinute || endMinute > window.closeMinute) {
      conflicts.push({ date: o.date, reason: 'outside_hours' });
      continue;
    }
    const reason = occupancyConflict(ctx.occupied, o.startsAt, o.endsAt, ctx.cleanupMinutes);
    if (reason !== null)
      conflicts.push({ date: o.date, reason: reason as OccurrenceConflictReason });
  }
  return conflicts;
}

const CONFLICT_LABELS: Record<OccurrenceConflictReason, string> = {
  closed: 'Dia fechado',
  outside_hours: 'Fora do horário de funcionamento',
  overlaps_booking: 'Já reservado',
  in_cleanup: 'Conflito com limpeza',
  no_cleanup_before_next: 'Conflito com limpeza',
  overlaps_block: 'Bloqueado',
};

/** pt-BR label of an occurrence conflict. */
export function occurrenceConflictLabel(reason: OccurrenceConflictReason): string {
  return CONFLICT_LABELS[reason];
}
