import {
  ACTIVE_STATUSES,
  addDays,
  businessWindow,
  diffDays,
  generateSlotGrid,
  localToUtc,
  utcToLocal,
  validateInterval,
  weekdayOf,
  priceBlockBooking,
  type AdminAvailabilityDay,
  type AdminCell,
  type AffectedBooking,
  type AvailabilityDay,
  type AvailabilityMonth,
  type BlockCategory,
  type BusinessDayKey,
  type BusinessHoursRow,
  type BookingStatus,
  type LocalDate,
  type PublicCell,
  type SlotCell,
} from '@bravo/core';
import { and, asc, eq, gt, inArray, or, sql } from 'drizzle-orm';
import type { Db, Tx } from '../../db/client';
import { bookingCategories, bookings, holidays, rooms, users } from '../../db/schema';
import type { Registry } from '../../extensions/registry';
import { notFound } from '../../lib/errors';
import {
  getActiveRoomBySlug,
  getRoomById,
  gridSettingsOf,
  loadCalendarInputs,
  type CalendarInputs,
  type Room,
} from '../calendar/calendar.repo';

const WEEKDAY_KEYS: Record<number, BusinessDayKey> = {
  1: 'mon',
  2: 'tue',
  3: 'wed',
  4: 'thu',
  5: 'fri',
  6: 'sat',
  7: 'sun',
};

interface DayView {
  date: LocalDate;
  isHoliday: boolean;
  holidayName: string | null;
  closed: boolean;
  outOfRange: boolean;
  window: { openMinute: number; closeMinute: number } | null;
  cells: SlotCell[];
}

function viewOf(room: Room, date: LocalDate, inputs: CalendarInputs, now: Date): DayView {
  const window = businessWindow({
    date,
    roomId: room.id,
    hours: inputs.hours,
    holidays: inputs.holidays,
    closedDays: inputs.closedDays,
  });
  const holiday = inputs.holidays.find((h) => h.date === date);
  const settings = gridSettingsOf(inputs.settings);
  const today = utcToLocal(now).date;
  const occupied = inputs.occupied.get(date) ?? [];
  return {
    date,
    isHoliday: holiday !== undefined,
    holidayName: holiday?.name ?? null,
    closed: window === null,
    outOfRange: diffDays(today, date) > settings.maxAdvanceDays,
    window:
      window === null ? null : { openMinute: window.openMinute, closeMinute: window.closeMinute },
    cells: generateSlotGrid({ date, window, occupied, settings, now }),
  };
}

const publicCell = (cell: SlotCell): PublicCell => ({
  startMinute: cell.startMinute,
  available: cell.state === 'available',
  maxEndMinute: cell.maxEndMinute,
});

async function loadBlockCategories(db: Db | Tx, roomId: string) {
  const rows = await db
    .select()
    .from(bookingCategories)
    .where(
      and(
        eq(bookingCategories.type, 'block'),
        eq(bookingCategories.status, 'active'),
        eq(bookingCategories.visibility, 'public'),
        or(sql`${bookingCategories.roomId} is null`, eq(bookingCategories.roomId, roomId)),
      ),
    )
    .orderBy(asc(bookingCategories.displayOrder));
  return rows.map((row): BlockCategory => ({
    id: row.id,
    name: row.name,
    weekdays: row.weekdays,
    appliesOnHolidays: row.appliesOnHolidays,
    startMinute: row.startMinute,
    endMinute: row.endMinute,
    fixedPriceCents: row.fixedPriceCents ?? 0,
  }));
}

/** Block categories applying to the day; `available` only when the whole window is a valid interval. */
async function blockOptionsOf(
  db: Db | Tx,
  room: Room,
  view: DayView,
  inputs: CalendarInputs,
  now: Date,
): Promise<AvailabilityDay['blockOptions']> {
  if (view.closed) return [];
  const settings = gridSettingsOf(inputs.settings);
  const occupied = inputs.occupied.get(view.date) ?? [];
  const options: AvailabilityDay['blockOptions'] = [];
  for (const category of await loadBlockCategories(db, room.id)) {
    const priced = priceBlockBooking(category, { date: view.date, isHoliday: view.isHoliday });
    if (priced === null) continue;
    const check = validateInterval({
      date: view.date,
      startMinute: priced.startMinute,
      endMinute: priced.endMinute,
      window: view.window,
      occupied,
      settings,
      now,
    });
    options.push({
      categoryId: category.id,
      name: category.name,
      startMinute: priced.startMinute,
      endMinute: priced.endMinute,
      priceCents: priced.grossCents,
      available: check.ok,
    });
  }
  return options;
}

function dayResponse(
  room: Room,
  view: DayView,
  inputs: CalendarInputs,
  blockOptions: AvailabilityDay['blockOptions'],
): Omit<AvailabilityDay, 'cells'> {
  return {
    date: view.date,
    roomSlug: room.slug,
    isHoliday: view.isHoliday,
    holidayName: view.holidayName,
    closed: view.closed,
    outOfRange: view.outOfRange,
    window: view.window,
    slotMinutes: inputs.settings['calendar.slot_minutes'],
    minBookingMinutes: inputs.settings['calendar.default_booking_minutes'],
    blockOptions,
  };
}

/** Public day grid (NUC-77, NUC-78, NUC-83): no admin states, names, tags or cleanup periods. */
export async function getDayAvailability(
  db: Db,
  roomSlug: string,
  date: LocalDate,
  now: Date,
  registry: Pick<Registry, 'availabilityDecorators'>,
): Promise<AvailabilityDay> {
  const room = await getActiveRoomBySlug(db, roomSlug);
  if (room === null) throw notFound();
  const inputs = await loadCalendarInputs(db, { roomId: room.id, from: date, to: date, now });
  const view = viewOf(room, date, inputs, now);
  let cells = view.cells.map(publicCell);
  for (const decorator of registry.availabilityDecorators) {
    cells = await decorator.decorate(db, { roomId: room.id, date, cells });
  }
  return {
    ...dayResponse(room, view, inputs, await blockOptionsOf(db, room, view, inputs, now)),
    cells,
  };
}

/** Admin day grid of any room: the same cells plus the `adminState` of each. */
export async function getAdminDay(
  db: Db,
  roomId: string,
  date: LocalDate,
  now: Date,
): Promise<AdminAvailabilityDay> {
  const room = await getRoomById(db, roomId);
  if (room === null) throw notFound();
  const inputs = await loadCalendarInputs(db, { roomId, from: date, to: date, now });
  const view = viewOf(room, date, inputs, now);
  const cells = view.cells.map((cell): AdminCell => ({
    ...publicCell(cell),
    adminState: cell.adminState,
  }));
  return {
    ...dayResponse(room, view, inputs, await blockOptionsOf(db, room, view, inputs, now)),
    cells,
  };
}

/**
 * Up to `count` free slots of `durationMinutes` in the next `days` days (NUC-117 suggestions):
 * the earliest slot of each distinct day first, then further slots of those days. Closed days,
 * days beyond the advance window and occupied or cleanup cells never appear.
 */
export async function suggestFreeSlots(
  db: Db | Tx,
  args: { roomId: string; durationMinutes: number; from: Date; days: number; count: number },
): Promise<{ startsAt: Date; endsAt: Date }[]> {
  const room = await getRoomById(db, args.roomId);
  if (room === null) return [];
  const first = utcToLocal(args.from).date;
  const last = addDays(first, args.days);
  const inputs = await loadCalendarInputs(db, {
    roomId: room.id,
    from: first,
    to: last,
    now: args.from,
  });
  const perDay: { date: LocalDate; startMinutes: number[] }[] = [];
  for (let date = first; date <= last; date = addDays(date, 1)) {
    const view = viewOf(room, date, inputs, args.from);
    if (view.closed || view.outOfRange) continue;
    const startMinutes = view.cells
      .filter(
        (cell) =>
          cell.state === 'available' &&
          cell.maxEndMinute !== null &&
          cell.maxEndMinute - cell.startMinute >= args.durationMinutes,
      )
      .map((cell) => cell.startMinute);
    if (startMinutes.length > 0) perDay.push({ date, startMinutes });
  }
  const picks: { date: LocalDate; startMinute: number }[] = [];
  for (let round = 0; picks.length < args.count; round++) {
    const before = picks.length;
    for (const day of perDay) {
      const startMinute = day.startMinutes[round];
      if (startMinute !== undefined && picks.length < args.count) {
        picks.push({ date: day.date, startMinute });
      }
    }
    if (picks.length === before) break;
  }
  return picks.map(({ date, startMinute }) => {
    const startsAt = localToUtc(date, startMinute);
    return { startsAt, endsAt: new Date(startsAt.getTime() + args.durationMinutes * 60_000) };
  });
}

function monthDates(month: string): LocalDate[] {
  const first = `${month}-01` as LocalDate;
  const dates: LocalDate[] = [];
  for (let date = first; date.startsWith(month); date = addDays(date, 1)) dates.push(date);
  return dates;
}

/** Month overview from a single occupancy query (NUC-79). */
export async function getMonthAvailability(
  db: Db,
  roomSlug: string,
  month: string,
  now: Date,
  registry?: Pick<Registry, 'availabilityDecorators'>,
): Promise<AvailabilityMonth> {
  const room = await getActiveRoomBySlug(db, roomSlug);
  if (room === null) throw notFound();
  const dates = monthDates(month);
  const first = dates[0];
  const last = dates.at(-1);
  if (first === undefined || last === undefined) throw notFound();
  const inputs = await loadCalendarInputs(db, { roomId: room.id, from: first, to: last, now });
  const today = utcToLocal(now).date;

  const days: AvailabilityMonth['days'] = [];
  for (const date of dates) {
    const view = viewOf(room, date, inputs, now);
    let status: AvailabilityMonth['days'][number]['status'];
    let hasDiscount = false;
    if (date < today) status = 'past';
    else if (view.outOfRange) status = 'out_of_range';
    else if (view.closed) status = 'closed';
    else if (view.cells.some((c) => c.state === 'available')) {
      status = 'available';
      const decorators = registry?.availabilityDecorators ?? [];
      if (decorators.length > 0) {
        let cells = view.cells.map(publicCell);
        for (const decorator of decorators) {
          cells = await decorator.decorate(db, { roomId: room.id, date, cells });
        }
        hasDiscount = cells.some((c) => c.discountPercent !== undefined);
      }
    } else status = view.cells.every((c) => c.adminState === 'past') ? 'past' : 'full';
    days.push({
      date,
      status,
      isHoliday: view.isHoliday,
      holidayName: view.holidayName,
      hasDiscount,
    });
  }
  return { month, days };
}

export interface AffectedPredicate {
  /** Only bookings starting after this instant count (usually `now`). */
  from: Date;
  /** null or undefined = every room. */
  roomIds?: string[] | null;
  /** Local dates of the booking start. */
  dates?: LocalDate[];
  /** Proposed weekly hours: bookings that no longer fit their day's window are affected. */
  proposedHours?: BusinessHoursRow[];
  /** Fixed-schedule occurrences belong to receita; closed-day callers leave them out. */
  includeFixedOccurrences?: boolean;
}

/**
 * Future active bookings hit by a calendar change (NUC-34, NUC-44, NUC-48, NUC-49). Holds that
 * already expired are free and never block a change.
 */
export async function findAffectedBookings(
  db: Db | Tx,
  predicate: AffectedPredicate,
): Promise<AffectedBooking[]> {
  const { from } = predicate;
  const dates = predicate.dates === undefined ? undefined : new Set(predicate.dates);
  const sortedDates = predicate.dates === undefined ? [] : [...predicate.dates].sort();
  const rows = await db
    .select({
      id: bookings.id,
      code: bookings.code,
      status: bookings.status,
      kind: bookings.kind,
      startsAt: bookings.startsAt,
      endsAt: bookings.endsAt,
      durationMinutes: bookings.durationMinutes,
      holdExpiresAt: bookings.holdExpiresAt,
      customerName: users.name,
      roomName: rooms.name,
    })
    .from(bookings)
    .innerJoin(users, eq(users.id, bookings.userId))
    .innerJoin(rooms, eq(rooms.id, bookings.roomId))
    .where(
      and(
        inArray(bookings.status, [...ACTIVE_STATUSES]),
        gt(bookings.startsAt, from),
        predicate.roomIds ? inArray(bookings.roomId, predicate.roomIds) : undefined,
        predicate.includeFixedOccurrences === true ? undefined : eq(bookings.kind, 'single'),
        sortedDates.length > 0
          ? and(
              sql`${bookings.startsAt} >= ${localToUtc(sortedDates[0] as LocalDate, 0).toISOString()}::timestamptz`,
              sql`${bookings.startsAt} < ${localToUtc(sortedDates.at(-1) as LocalDate, 1440).toISOString()}::timestamptz`,
            )
          : undefined,
      ),
    )
    .orderBy(asc(bookings.startsAt));

  const live = rows.filter(
    (row) =>
      !(
        (row.status === 'awaiting_payment' ||
          row.status === 'pre_reserved' ||
          row.status === 'held_for_renewal') &&
        row.holdExpiresAt !== null &&
        row.holdExpiresAt <= from
      ),
  );

  let holidayDates = new Set<string>();
  if (predicate.proposedHours !== undefined && live.length > 0) {
    const holidayRows = await db.select({ date: holidays.date }).from(holidays);
    holidayDates = new Set(holidayRows.map((h) => h.date));
  }

  return live
    .filter((row) => {
      const start = utcToLocal(row.startsAt);
      if (dates !== undefined && !dates.has(start.date)) return false;
      if (predicate.proposedHours === undefined) return true;
      const key = holidayDates.has(start.date) ? 'holiday' : WEEKDAY_KEYS[weekdayOf(start.date)];
      const hours = predicate.proposedHours.find((h) => h.dayType === key);
      if (hours === undefined || hours.isClosed) return true;
      return (
        start.minuteOfDay < hours.openMinute ||
        start.minuteOfDay + row.durationMinutes > hours.closeMinute
      );
    })
    .map((row) => ({
      id: row.id,
      code: row.code,
      customerName: row.customerName,
      roomName: row.roomName,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      status: row.status as BookingStatus,
    }));
}
