import { mulDivRoundHalfUp, type Cents } from '../money';

export interface HourlyCategory {
  id: string;
  name: string;
  /** ISO weekdays where the category applies (1 = Monday). */
  weekdays: number[];
  appliesOnHolidays: boolean;
  startMinute: number;
  endMinute: number;
  weekdayRateCents: Cents;
  /** Saturday, Sunday and holiday rate. */
  weekendRateCents: Cents;
  minDurationMinutes: number;
  status: 'active' | 'inactive';
  isReference: boolean;
  displayOrder: number;
}

export interface BlockCategory {
  id: string;
  name: string;
  weekdays: number[];
  appliesOnHolidays: boolean;
  startMinute: number;
  endMinute: number;
  fixedPriceCents: Cents;
}

export interface HourPackageCategory {
  id: string;
  name: string;
  fixedPriceCents: Cents;
  includedMinutes: number;
}

export interface FixedScheduleCategory {
  id: string;
  name: string;
  startMinute: number;
  endMinute: number;
  pricePerOccurrenceCents: Cents;
}

export type AnyCategory =
  | ({ type: 'hourly' } & HourlyCategory)
  | ({ type: 'block' } & BlockCategory)
  | ({ type: 'hour_package' } & HourPackageCategory)
  | ({ type: 'fixed_schedule' } & FixedScheduleCategory);

/** Whether a category's days apply to a date: on a holiday only `appliesOnHolidays` decides. */
export function appliesOnDay(
  cat: { weekdays: number[]; appliesOnHolidays: boolean },
  day: { weekday: number; isHoliday: boolean },
): boolean {
  return day.isHoliday ? cat.appliesOnHolidays : cat.weekdays.includes(day.weekday);
}

/**
 * The active hourly category for the segment `[minuteFrom, minuteTo)` of a booking (PRD 5.3):
 * among those applying to the day and covering the segment, the largest `minDurationMinutes` not
 * greater than the whole booking duration; ties go to the lowest display order.
 */
export function selectHourlyCategory(
  cats: HourlyCategory[],
  args: {
    weekday: number;
    isHoliday: boolean;
    minuteFrom: number;
    minuteTo: number;
    bookingDurationMinutes: number;
  },
): HourlyCategory | null {
  let best: HourlyCategory | null = null;
  for (const cat of cats) {
    if (cat.status !== 'active' || !appliesOnDay(cat, args)) continue;
    if (cat.startMinute > args.minuteFrom || cat.endMinute < args.minuteTo) continue;
    if (cat.minDurationMinutes > args.bookingDurationMinutes) continue;
    if (
      best === null ||
      cat.minDurationMinutes > best.minDurationMinutes ||
      (cat.minDurationMinutes === best.minDurationMinutes && cat.displayOrder < best.displayOrder)
    ) {
      best = cat;
    }
  }
  return best;
}

/** "Valor médio da hora": price per hour of `minutes`, half up (160000 / 1200 min -> 8000). */
export function averageHourlyCents(args: { priceCents: Cents; minutes: number }): Cents {
  return mulDivRoundHalfUp(args.priceCents, 60, args.minutes);
}

/** Average hourly value shown next to every category price (PRD 5.3, NUC-22). */
export function categoryAverageHourlyCents(cat: AnyCategory): Cents {
  switch (cat.type) {
    case 'hourly':
      return cat.weekdayRateCents;
    case 'block':
      return averageHourlyCents({
        priceCents: cat.fixedPriceCents,
        minutes: cat.endMinute - cat.startMinute,
      });
    case 'hour_package':
      return averageHourlyCents({ priceCents: cat.fixedPriceCents, minutes: cat.includedMinutes });
    case 'fixed_schedule':
      return averageHourlyCents({
        priceCents: cat.pricePerOccurrenceCents,
        minutes: cat.endMinute - cat.startMinute,
      });
  }
}

/** "A partir de": the lowest weekday or weekend rate of the active hourly categories given. */
export function fromPriceCents(cats: HourlyCategory[]): Cents | null {
  const rates = cats
    .filter((c) => c.status === 'active')
    .flatMap((c) => [c.weekdayRateCents, c.weekendRateCents]);
  return rates.length === 0 ? null : Math.min(...rates);
}
