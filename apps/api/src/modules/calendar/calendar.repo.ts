import {
  addDays,
  businessWindow,
  diffDays,
  HOLDING_STATUSES,
  localToUtc,
  occupiedFromBlock,
  occupiedFromBooking,
  utcToLocal,
  type BusinessHoursRow,
  type BusinessWindow,
  type ClosedDayRef,
  type GridSettings,
  type HolidayRef,
  type HourlyCategory,
  type LocalDate,
  type Occupied,
  type SettingsValues,
} from '@bravo/core';
import { and, asc, between, eq, isNull, or, sql } from 'drizzle-orm';
import type { Db, Tx } from '../../db/client';
import {
  blocks,
  bookingCategories,
  bookings,
  businessHours,
  closedDays,
  holidays,
  roomOccupancy,
  rooms,
} from '../../db/schema';
import { loadSettings } from '../settings/settings.repo';

export type Room = typeof rooms.$inferSelect;
export interface HolidayInfo extends HolidayRef {
  name: string;
}

export interface CalendarInputs {
  hours: BusinessHoursRow[];
  holidays: HolidayInfo[];
  closedDays: ClosedDayRef[];
  /** Active occupancy per local date it touches (cleanup included); stale holds are left out. */
  occupied: Map<LocalDate, Occupied[]>;
  settings: SettingsValues;
}

/** The grid-relevant calendar settings (NUC-11, NUC-12); the minimum duration is the default one. */
export function gridSettingsOf(settings: SettingsValues): GridSettings {
  return {
    slotMinutes: settings['calendar.slot_minutes'],
    minBookingMinutes: settings['calendar.default_booking_minutes'],
    cleanupMinutes: settings['calendar.cleanup_minutes'],
    minAdvanceMinutes: settings['calendar.min_advance_minutes'],
    maxAdvanceDays: settings['calendar.max_advance_days'],
  };
}

export async function getActiveRoomBySlug(db: Db | Tx, slug: string): Promise<Room | null> {
  const [room] = await db
    .select()
    .from(rooms)
    .where(and(eq(rooms.slug, slug), eq(rooms.status, 'active')));
  return room ?? null;
}

export async function getRoomById(db: Db | Tx, id: string): Promise<Room | null> {
  const [room] = await db.select().from(rooms).where(eq(rooms.id, id));
  return room ?? null;
}

export async function loadBusinessHours(db: Db | Tx): Promise<BusinessHoursRow[]> {
  const rows = await db.select().from(businessHours);
  return rows.map((row) => ({
    dayType: row.dayType as BusinessHoursRow['dayType'],
    isClosed: row.isClosed,
    openMinute: row.openMinute,
    closeMinute: row.closeMinute,
  }));
}

/** Local dates an instant range touches, e.g. a cleanup that passes midnight touches two. */
function datesTouched(start: Date, until: Date): LocalDate[] {
  const first = utcToLocal(start).date;
  const last = utcToLocal(new Date(until.getTime() - 1)).date;
  const out: LocalDate[] = [];
  for (let offset = 0; offset <= diffDays(first, last); offset++) out.push(addDays(first, offset));
  return out;
}

/**
 * Everything the grid needs for `roomId` between two local dates: one query per input (NUC-79).
 * Holding bookings whose `hold_expires_at` has passed are treated as free (NUC-80).
 */
export async function loadCalendarInputs(
  db: Db | Tx,
  args: { roomId: string; from: LocalDate; to: LocalDate; now: Date },
): Promise<CalendarInputs> {
  const { roomId, from, to, now } = args;
  const rangeStart = localToUtc(addDays(from, -1), 0).toISOString();
  const rangeEnd = localToUtc(addDays(to, 1), 1440).toISOString();

  const [hours, holidayRows, closedRows, occupancyRows, settings] = await Promise.all([
    loadBusinessHours(db),
    db
      .select({
        date: holidays.date,
        name: holidays.name,
        isClosed: holidays.isClosed,
      })
      .from(holidays)
      .where(between(holidays.date, from, to)),
    db
      .select({ date: closedDays.date, roomId: closedDays.roomId })
      .from(closedDays)
      .where(
        and(
          between(closedDays.date, from, to),
          or(isNull(closedDays.roomId), eq(closedDays.roomId, roomId)),
        ),
      ),
    db
      .select({
        kind: roomOccupancy.kind,
        bookingStart: bookings.startsAt,
        bookingEnd: bookings.endsAt,
        cleanupMinutes: bookings.cleanupMinutes,
        blockStart: blocks.startsAt,
        blockEnd: blocks.endsAt,
        blockTag: blocks.tag,
      })
      .from(roomOccupancy)
      .leftJoin(
        bookings,
        and(eq(roomOccupancy.kind, 'booking'), eq(bookings.id, roomOccupancy.refId)),
      )
      .leftJoin(blocks, and(eq(roomOccupancy.kind, 'block'), eq(blocks.id, roomOccupancy.refId)))
      .where(
        and(
          eq(roomOccupancy.roomId, roomId),
          eq(roomOccupancy.active, true),
          sql`${roomOccupancy.period} && tstzrange(${rangeStart}::timestamptz, ${rangeEnd}::timestamptz, '[)')`,
          sql`not coalesce(${bookings.status} in (${sql.join(
            HOLDING_STATUSES.map((s) => sql`${s}`),
            sql`, `,
          )}) and ${bookings.holdExpiresAt} <= ${now.toISOString()}::timestamptz, false)`,
        ),
      ),
    loadSettings(db),
  ]);

  const occupied = new Map<LocalDate, Occupied[]>();
  for (const row of occupancyRows) {
    let item: Occupied | null = null;
    if (row.kind === 'booking' && row.bookingStart && row.bookingEnd && row.cleanupMinutes !== null) {
      item = occupiedFromBooking({
        start: row.bookingStart,
        end: row.bookingEnd,
        cleanupMinutes: row.cleanupMinutes,
      });
    } else if (row.kind === 'block' && row.blockStart && row.blockEnd) {
      item = occupiedFromBlock({ start: row.blockStart, end: row.blockEnd, tag: row.blockTag ?? '' });
    }
    if (item === null) continue;
    for (const date of datesTouched(item.start, item.occupiedUntil)) {
      const list = occupied.get(date) ?? [];
      list.push(item);
      occupied.set(date, list);
    }
  }

  return {
    hours,
    holidays: holidayRows.map((h) => ({ date: h.date as LocalDate, name: h.name, isClosed: h.isClosed })),
    closedDays: closedRows.map((c) => ({ date: c.date as LocalDate, roomId: c.roomId })),
    occupied,
    settings,
  };
}

export interface DayContext {
  window: BusinessWindow | null;
  occupied: Occupied[];
  closed: boolean;
  isHoliday: boolean;
  holidayName: string | null;
}

/** Window, occupied intervals and closed flag per date of one room (exported for receita). */
export async function loadDayContexts(
  db: Db | Tx,
  args: { roomId: string; dates: LocalDate[]; now?: Date },
): Promise<Map<LocalDate, DayContext>> {
  const sorted = [...args.dates].sort();
  const result = new Map<LocalDate, DayContext>();
  const first = sorted[0];
  const last = sorted.at(-1);
  if (first === undefined || last === undefined) return result;
  const inputs = await loadCalendarInputs(db, {
    roomId: args.roomId,
    from: first,
    to: last,
    now: args.now ?? new Date(),
  });
  for (const date of sorted) {
    const window = businessWindow({
      date,
      roomId: args.roomId,
      hours: inputs.hours,
      holidays: inputs.holidays,
      closedDays: inputs.closedDays,
    });
    const holiday = inputs.holidays.find((h) => h.date === date);
    result.set(date, {
      window,
      occupied: inputs.occupied.get(date) ?? [],
      closed: window === null,
      isHoliday: holiday !== undefined,
      holidayName: holiday?.name ?? null,
    });
  }
  return result;
}

type CategoryRow = typeof bookingCategories.$inferSelect;

export function toHourlyCategory(row: CategoryRow): HourlyCategory {
  return {
    id: row.id,
    name: row.name,
    weekdays: row.weekdays,
    appliesOnHolidays: row.appliesOnHolidays,
    startMinute: row.startMinute,
    endMinute: row.endMinute,
    weekdayRateCents: row.weekdayRateCents ?? 0,
    weekendRateCents: row.weekendRateCents ?? 0,
    minDurationMinutes: row.minDurationMinutes ?? 60,
    status: row.status as 'active' | 'inactive',
    isReference: row.isReference,
    displayOrder: row.displayOrder,
  };
}

/** Hourly categories by display order; public site callers leave `adminOnly` out. */
export async function loadHourlyCategories(
  db: Db | Tx,
  opts: { includeAdminOnly?: boolean } = {},
): Promise<HourlyCategory[]> {
  const rows = await db
    .select()
    .from(bookingCategories)
    .where(
      and(
        eq(bookingCategories.type, 'hourly'),
        opts.includeAdminOnly === true ? undefined : eq(bookingCategories.visibility, 'public'),
      ),
    )
    .orderBy(asc(bookingCategories.displayOrder));
  return rows.map(toHourlyCategory);
}

/** The V_ref category ("1 hora" in the factory table), or null when none is flagged. */
export async function getReferenceCategory(db: Db | Tx): Promise<HourlyCategory | null> {
  const [row] = await db
    .select()
    .from(bookingCategories)
    .where(and(eq(bookingCategories.type, 'hourly'), eq(bookingCategories.isReference, true)));
  return row === undefined ? null : toHourlyCategory(row);
}

export type { CategoryRow };
