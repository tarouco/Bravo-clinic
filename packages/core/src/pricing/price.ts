import { mulDivRoundHalfUp, type Cents } from '../money';
import { weekdayOf, type LocalDate } from '../time';
import { resolveDayType, type DayType } from '../calendar/day-type';
import {
  appliesOnDay,
  selectHourlyCategory,
  type BlockCategory,
  type HourlyCategory,
} from './categories';

export interface PricedSegment {
  startMinute: number;
  endMinute: number;
  minutes: number;
  categoryId: string;
  categoryName: string;
  dayType: DayType;
  rateCentsPerHour: Cents;
  amountCents: Cents;
}

interface Range {
  startMinute: number;
  endMinute: number;
}

/** `[from, to)` split at every category window boundary that falls strictly inside it. */
function pieces(cats: HourlyCategory[], from: number, to: number): Range[] {
  const cuts = new Set<number>([from, to]);
  for (const c of cats) {
    for (const m of [c.startMinute, c.endMinute]) if (m > from && m < to) cuts.add(m);
  }
  const sorted = [...cuts].sort((a, b) => a - b);
  return sorted.slice(1).map((end, i) => ({ startMinute: sorted[i] ?? from, endMinute: end }));
}

function rateFor(cat: HourlyCategory, dayType: DayType): Cents {
  return dayType === 'weekend_holiday' ? cat.weekendRateCents : cat.weekdayRateCents;
}

function dayTypeOf(date: LocalDate, isHoliday: boolean): DayType {
  return resolveDayType(date, isHoliday ? [{ date, isClosed: false }] : []);
}

/**
 * Prices an hourly booking per category segment (PRD 5.3, architecture 7.5). Each segment
 * costs `mulDivRoundHalfUp(rate, minutes, 60)`; a minute without category fails with the first
 * uncovered range.
 */
export function priceHourlyBooking(args: {
  date: LocalDate;
  startMinute: number;
  endMinute: number;
  isHoliday: boolean;
  categories: HourlyCategory[];
}):
  | { ok: true; segments: PricedSegment[]; grossCents: Cents }
  | { ok: false; reason: 'no_category'; uncovered: Range } {
  const { date, startMinute, endMinute, isHoliday, categories } = args;
  const weekday = weekdayOf(date);
  const dayType = dayTypeOf(date, isHoliday);
  const duration = endMinute - startMinute;
  const chosen = pieces(categories, startMinute, endMinute).map((p) => ({
    ...p,
    cat: selectHourlyCategory(categories, {
      weekday,
      isHoliday,
      minuteFrom: p.startMinute,
      minuteTo: p.endMinute,
      bookingDurationMinutes: duration,
    }),
  }));

  const firstGap = chosen.findIndex((p) => p.cat === null);
  if (firstGap >= 0) {
    let end = firstGap;
    while (chosen[end + 1]?.cat === null) end += 1;
    return {
      ok: false,
      reason: 'no_category',
      uncovered: {
        startMinute: chosen[firstGap]?.startMinute ?? startMinute,
        endMinute: chosen[end]?.endMinute ?? endMinute,
      },
    };
  }

  const merged: { startMinute: number; endMinute: number; cat: HourlyCategory }[] = [];
  for (const p of chosen) {
    if (p.cat === null) continue;
    const last = merged.at(-1);
    if (last?.cat.id === p.cat.id) last.endMinute = p.endMinute;
    else merged.push({ startMinute: p.startMinute, endMinute: p.endMinute, cat: p.cat });
  }

  const segments = merged.map((m): PricedSegment => {
    const minutes = m.endMinute - m.startMinute;
    const rate = rateFor(m.cat, dayType);
    return {
      startMinute: m.startMinute,
      endMinute: m.endMinute,
      minutes,
      categoryId: m.cat.id,
      categoryName: m.cat.name,
      dayType,
      rateCentsPerHour: rate,
      amountCents: mulDivRoundHalfUp(rate, minutes, 60),
    };
  });
  return { ok: true, segments, grossCents: segments.reduce((sum, s) => sum + s.amountCents, 0) };
}

/** A block category's fixed price and window when its days (or holiday flag) apply, else null. */
export function priceBlockBooking(
  cat: BlockCategory,
  args: { date: LocalDate; isHoliday: boolean },
): { grossCents: Cents; startMinute: number; endMinute: number } | null {
  if (!appliesOnDay(cat, { weekday: weekdayOf(args.date), isHoliday: args.isHoliday })) return null;
  return {
    grossCents: cat.fixedPriceCents,
    startMinute: cat.startMinute,
    endMinute: cat.endMinute,
  };
}

/**
 * V_slot of one segment (PRD 5.3): the rate of the hourly category that applies to
 * `[minuteFrom, minuteTo)` for the whole booking duration; null when none applies.
 */
export function vSlotForInterval(args: {
  date: LocalDate;
  isHoliday: boolean;
  minuteFrom: number;
  minuteTo: number;
  bookingDurationMinutes: number;
  categories: HourlyCategory[];
}): Cents | null {
  const cat = selectHourlyCategory(args.categories, {
    weekday: weekdayOf(args.date),
    isHoliday: args.isHoliday,
    minuteFrom: args.minuteFrom,
    minuteTo: args.minuteTo,
    bookingDurationMinutes: args.bookingDurationMinutes,
  });
  return cat === null ? null : rateFor(cat, dayTypeOf(args.date, args.isHoliday));
}

/**
 * Category overlay of one day (NUC-24): a band per active category applying to the day, clipped
 * to the business window, and the ranges of the window where a booking of `durationMinutes`
 * would find no category.
 */
export function coverageBands(
  cats: HourlyCategory[],
  day: { weekday: number; isHoliday: boolean },
  window: { openMinute: number; closeMinute: number },
  durationMinutes: number,
): {
  bands: {
    categoryId: string;
    name: string;
    startMinute: number;
    endMinute: number;
    rateCents: Cents;
  }[];
  uncovered: Range[];
} {
  const dayType: DayType = day.isHoliday || day.weekday >= 6 ? 'weekend_holiday' : 'weekday';
  const bands = cats
    .filter((c) => c.status === 'active' && appliesOnDay(c, day))
    .map((c) => ({
      categoryId: c.id,
      name: c.name,
      startMinute: Math.max(c.startMinute, window.openMinute),
      endMinute: Math.min(c.endMinute, window.closeMinute),
      rateCents: rateFor(c, dayType),
    }))
    .filter((b) => b.endMinute > b.startMinute);

  const uncovered: Range[] = [];
  for (const p of pieces(cats, window.openMinute, window.closeMinute)) {
    const cat = selectHourlyCategory(cats, {
      ...day,
      minuteFrom: p.startMinute,
      minuteTo: p.endMinute,
      bookingDurationMinutes: durationMinutes,
    });
    if (cat !== null) continue;
    const last = uncovered.at(-1);
    if (last?.endMinute === p.startMinute) last.endMinute = p.endMinute;
    else uncovered.push({ ...p });
  }
  return { bands, uncovered };
}
