/** The clinic runs in a single time zone (PRD 5.2). It is a constant, not a setting. */
export const CLINIC_TZ = 'America/Sao_Paulo';

/** Local calendar date in the clinic zone, `'YYYY-MM-DD'`. */
export type LocalDate = `${number}-${number}-${number}`;

export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

// All UTC offsets come from the IANA zone database through Intl; nothing is hard-coded.
const partsFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: CLINIC_TZ,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallClockOf(instantMs: number): WallClock {
  const out: WallClock = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 };
  for (const part of partsFormat.formatToParts(new Date(instantMs))) {
    if (
      part.type === 'year' ||
      part.type === 'month' ||
      part.type === 'day' ||
      part.type === 'hour' ||
      part.type === 'minute' ||
      part.type === 'second'
    ) {
      out[part.type] = Number(part.value);
    }
  }
  return out;
}

/** Offset of the clinic zone from UTC, in milliseconds, at the given instant. */
function offsetMsAt(instantMs: number): number {
  const w = wallClockOf(instantMs);
  const wallAsUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return wallAsUtc - Math.floor(instantMs / 1000) * 1000;
}

const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseLocalDate(date: string): { year: number; month: number; day: number } {
  const match = LOCAL_DATE.exec(date);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const probe = new Date(Date.UTC(year, month - 1, day));
    if (
      probe.getUTCFullYear() === year &&
      probe.getUTCMonth() === month - 1 &&
      probe.getUTCDate() === day
    ) {
      return { year, month, day };
    }
  }
  throw new Error(`Invalid local date: ${date}`);
}

function toLocalDate(ms: number): LocalDate {
  const d = new Date(ms);
  const y = String(d.getUTCFullYear()).padStart(4, '0');
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}` as LocalDate;
}

function dayNumber(date: LocalDate): number {
  const { year, month, day } = parseLocalDate(date);
  return Math.round(Date.UTC(year, month - 1, day) / MS_PER_DAY);
}

/**
 * The instant at which the clinic wall clock shows `date` + `minuteOfDay`.
 * `minuteOfDay` 1440 is 00:00 of the next local day.
 */
export function localToUtc(date: LocalDate, minuteOfDay: number): Date {
  if (!Number.isInteger(minuteOfDay)) {
    throw new Error(`minuteOfDay must be an integer, received ${String(minuteOfDay)}`);
  }
  const { year, month, day } = parseLocalDate(date);
  const wallAsUtc = Date.UTC(year, month - 1, day) + minuteOfDay * MS_PER_MINUTE;
  const firstOffset = offsetMsAt(wallAsUtc - offsetMsAt(wallAsUtc));
  let instant = wallAsUtc - firstOffset;
  const secondOffset = offsetMsAt(instant);
  if (secondOffset !== firstOffset) instant = wallAsUtc - secondOffset;
  return new Date(instant);
}

/** Clinic-zone calendar date, minute of the local day and ISO weekday (1 = Monday) of an instant. */
export function utcToLocal(instant: Date): {
  date: LocalDate;
  minuteOfDay: number;
  weekday: IsoWeekday;
} {
  const w = wallClockOf(instant.getTime());
  const date = toLocalDate(Date.UTC(w.year, w.month - 1, w.day));
  return { date, minuteOfDay: w.hour * 60 + w.minute, weekday: weekdayOf(date) };
}

/** `date` shifted by a whole number of calendar days (negative allowed). */
export function addDays(date: LocalDate, days: number): LocalDate {
  if (!Number.isInteger(days)) throw new Error(`days must be an integer, received ${String(days)}`);
  return toLocalDate((dayNumber(date) + days) * MS_PER_DAY);
}

/** ISO weekday of a calendar date: 1 = Monday ... 7 = Sunday. */
export function weekdayOf(date: LocalDate): IsoWeekday {
  const jsDay = new Date(dayNumber(date) * MS_PER_DAY).getUTCDay();
  return (jsDay === 0 ? 7 : jsDay) as IsoWeekday;
}

/** The half-open UTC range `[start, end)` covered by a local calendar day. */
export function localDayRangeUtc(date: LocalDate): { start: Date; end: Date } {
  return { start: localToUtc(date, 0), end: localToUtc(date, 1440) };
}

/** Calendar days from `a` to `b` (`b - a`), so `addDays(a, diffDays(a, b)) === b`. */
export function diffDays(a: LocalDate, b: LocalDate): number {
  return dayNumber(b) - dayNumber(a);
}

function two(n: number): string {
  return String(n).padStart(2, '0');
}

/** "27/10/2026" */
export function formatDateBR(instant: Date): string {
  const w = wallClockOf(instant.getTime());
  return `${two(w.day)}/${two(w.month)}/${String(w.year).padStart(4, '0')}`;
}

/** "10:00" */
export function formatTimeBR(instant: Date): string {
  const w = wallClockOf(instant.getTime());
  return `${two(w.hour)}:${two(w.minute)}`;
}

/** "27/10/2026 10:00" */
export function formatDateTimeBR(instant: Date): string {
  return `${formatDateBR(instant)} ${formatTimeBR(instant)}`;
}

/** Minute of the day to "HH:MM": 570 -> "09:30", 1440 -> "00:00". */
export function minuteToHHMM(m: number): string {
  if (!Number.isInteger(m) || m < 0 || m > 1440) {
    throw new Error(`minute of day out of range 0..1440: ${String(m)}`);
  }
  const wrapped = m % 1440;
  return `${two(Math.floor(wrapped / 60))}:${two(wrapped % 60)}`;
}
