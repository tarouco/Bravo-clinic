import {
  bookingStatusLabel,
  formatDateTimeBR,
  localToUtc,
  utcToLocal,
  type AdminBookingDetail,
  type BookingStatus,
  type BookingSummary,
  type CalendarEvents,
  type LocalDate,
} from '@bravo/core';
import { and, asc, desc, eq, gt, inArray, lt, notInArray, or, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { bookingSegments, bookings, holidays, rooms, users } from '../../db/schema';
import type { BookingRow, Registry } from '../../extensions/registry';
import { decodeCursor, encodeCursor } from '../../lib/cursor';
import { AppError, notFound } from '../../lib/errors';
import { listBlocks } from '../calendar/blocks.service';
import { holidayView, listClosedDays } from '../calendar/exceptions.service';
import {
  BOOKING_PAGE_SIZE,
  loadBookingDetail,
  refundedCentsByBooking,
  toBookingSummary,
} from '../booking/booking-serializer.service';

const INACTIVE: BookingStatus[] = [
  'expired',
  'cancelled_by_tenant',
  'cancelled_nonpayment',
  'cancelled_by_clinic',
];

export const CSV_MAX_ROWS = 5000;
/** Byte order mark: Brazilian Excel reads the file as UTF-8 only with it. */
const BOM = '\uFEFF';

// --- Calendar feed --------------------------------------------------------------------------------

export interface CalendarEventsFilters {
  from: LocalDate;
  to: LocalDate;
  roomId?: string | undefined;
  status?: BookingStatus | undefined;
  categoryId?: string | undefined;
}

const hasCategory = (categoryId: string) =>
  sql`exists (select 1 from ${bookingSegments} where ${bookingSegments.bookingId} = ${bookings.id} and ${bookingSegments.categoryId} = ${categoryId}::uuid)`;

/** Holds whose time ran out are free slots, not events (NUC-80). */
const liveHold = (now: Date) =>
  sql`not (${bookings.status} in ('awaiting_payment', 'pre_reserved', 'held_for_renewal') and ${bookings.holdExpiresAt} <= ${now.toISOString()}::timestamptz)`;

/**
 * The week or month feed of Gestão de Reservas (NUC-157): bookings with first and full name,
 * cleanup end and category names, blocks with their tag, closed days and holidays. Without a
 * status filter, expired and cancelled bookings stay out of the calendar. The 42-day range is
 * validated by the request schema.
 */
export async function adminCalendarEvents(
  db: Db,
  filters: CalendarEventsFilters,
  now: Date,
): Promise<CalendarEvents> {
  const rangeStart = localToUtc(filters.from, 0);
  const rangeEnd = localToUtc(filters.to, 1440);
  const rows = await db
    .select({ booking: bookings, roomName: rooms.name, customerName: users.name })
    .from(bookings)
    .innerJoin(rooms, eq(rooms.id, bookings.roomId))
    .innerJoin(users, eq(users.id, bookings.userId))
    .where(
      and(
        lt(bookings.startsAt, rangeEnd),
        gt(bookings.endsAt, rangeStart),
        filters.status === undefined
          ? notInArray(bookings.status, INACTIVE)
          : eq(bookings.status, filters.status),
        liveHold(now),
        filters.roomId === undefined ? undefined : eq(bookings.roomId, filters.roomId),
        filters.categoryId === undefined ? undefined : hasCategory(filters.categoryId),
      ),
    )
    .orderBy(asc(bookings.startsAt), asc(bookings.id));

  const segments =
    rows.length === 0
      ? []
      : await db
          .select({
            bookingId: bookingSegments.bookingId,
            name: bookingSegments.categoryName,
            seq: bookingSegments.seq,
          })
          .from(bookingSegments)
          .where(
            inArray(
              bookingSegments.bookingId,
              rows.map((r) => r.booking.id),
            ),
          )
          .orderBy(asc(bookingSegments.seq));
  const namesOf = new Map<string, string[]>();
  for (const segment of segments) {
    const names = namesOf.get(segment.bookingId) ?? [];
    if (!names.includes(segment.name)) names.push(segment.name);
    namesOf.set(segment.bookingId, names);
  }

  const today = utcToLocal(now).date;
  const [blockItems, closed, holidayRows] = await Promise.all([
    listBlocks(db, { from: filters.from, to: filters.to, roomId: filters.roomId }),
    listClosedDays(db, filters.from, filters.to),
    db
      .select()
      .from(holidays)
      .where(and(sql`${holidays.date} >= ${filters.from}`, sql`${holidays.date} <= ${filters.to}`))
      .orderBy(asc(holidays.date), asc(holidays.name)),
  ]);

  return {
    bookings: rows.map(({ booking, roomName, customerName }) => ({
      id: booking.id,
      code: booking.code,
      firstName: customerName.split(' ')[0] ?? customerName,
      fullName: customerName,
      roomId: booking.roomId,
      roomName,
      status: booking.status as BookingStatus,
      statusLabel: bookingStatusLabel[booking.status as BookingStatus],
      paidCents: booking.paidCents,
      totalCents: booking.totalCents,
      // Filled by receita from the debited minutes of the booking.
      packageMinutes: 0,
      startsAt: booking.startsAt.toISOString(),
      endsAt: booking.endsAt.toISOString(),
      cleanupUntil: new Date(
        booking.endsAt.getTime() + booking.cleanupMinutes * 60_000,
      ).toISOString(),
      categoryNames: namesOf.get(booking.id) ?? [],
      checkedInAt: booking.checkedInAt?.toISOString() ?? null,
      holdExpiresAt: booking.holdExpiresAt?.toISOString() ?? null,
    })),
    blocks: blockItems,
    closedDays: closed.filter(
      (c) => c.roomId === null || filters.roomId === undefined || c.roomId === filters.roomId,
    ),
    holidays: holidayRows.map((row) => holidayView(row, today)),
  };
}

// --- Bookings list ----------------------------------------------------------------------------------

export interface BookingListFilters {
  q?: string | undefined;
  status?: BookingStatus | undefined;
  roomId?: string | undefined;
  categoryId?: string | undefined;
  from?: LocalDate | undefined;
  to?: LocalDate | undefined;
}

const escapeLike = (text: string) => text.replace(/[\\%_]/g, (char) => `\\${char}`);

function listConditions(filters: BookingListFilters): (SQL | undefined)[] {
  const q = filters.q?.trim();
  const pattern = q === undefined || q === '' ? undefined : `%${escapeLike(q)}%`;
  return [
    pattern === undefined
      ? undefined
      : or(
          sql`${bookings.code} ilike ${pattern}`,
          sql`${users.name} ilike ${pattern}`,
          sql`${users.email} ilike ${pattern}`,
        ),
    filters.status === undefined ? undefined : eq(bookings.status, filters.status),
    filters.roomId === undefined ? undefined : eq(bookings.roomId, filters.roomId),
    filters.categoryId === undefined ? undefined : hasCategory(filters.categoryId),
    filters.from === undefined
      ? undefined
      : sql`${bookings.startsAt} >= ${localToUtc(filters.from, 0).toISOString()}::timestamptz`,
    filters.to === undefined
      ? undefined
      : sql`${bookings.startsAt} < ${localToUtc(filters.to, 1440).toISOString()}::timestamptz`,
  ];
}

export type AdminBookingSummary = BookingSummary & {
  customerName: string;
  customerEmail: string;
  source: BookingRow['source'];
};

/** `GET /admin/bookings` (NUC-177): newest start first, 50 per page, keyset cursor. */
export async function listAdminBookings(
  db: Db,
  filters: BookingListFilters,
  cursor: string | undefined,
): Promise<{ items: AdminBookingSummary[]; nextCursor: string | null }> {
  const after = cursor === undefined ? undefined : decodeCursor(cursor);
  const rows = await db
    .select({
      booking: bookings,
      roomSlug: rooms.slug,
      roomName: rooms.name,
      customerName: users.name,
      customerEmail: users.email,
    })
    .from(bookings)
    .innerJoin(rooms, eq(rooms.id, bookings.roomId))
    .innerJoin(users, eq(users.id, bookings.userId))
    .where(
      and(
        ...listConditions(filters),
        after === undefined
          ? undefined
          : sql`(${bookings.startsAt}, ${bookings.id}) < (${after.at.toISOString()}::timestamptz, ${after.id}::uuid)`,
      ),
    )
    .orderBy(desc(bookings.startsAt), desc(bookings.id))
    .limit(BOOKING_PAGE_SIZE + 1);
  const page = rows.slice(0, BOOKING_PAGE_SIZE);
  const refunded = await refundedCentsByBooking(
    db,
    page.map((r) => r.booking.id),
  );
  const last = page.at(-1);
  return {
    items: page.map((r) => ({
      ...toBookingSummary(r.booking, {
        roomSlug: r.roomSlug,
        roomName: r.roomName,
        refundedCents: refunded.get(r.booking.id) ?? 0,
      }),
      customerName: r.customerName,
      customerEmail: r.customerEmail,
      source: r.booking.source,
    })),
    nextCursor:
      rows.length > BOOKING_PAGE_SIZE && last !== undefined
        ? encodeCursor({ at: last.booking.startsAt, id: last.booking.id })
        : null,
  };
}

/** `GET /admin/bookings/:id`: the booking as its owner sees it plus the customer. */
export async function getAdminBooking(
  db: Db,
  bookingId: string,
  now: Date,
  registry: Pick<Registry, 'paymentModeHandlers'>,
): Promise<AdminBookingDetail> {
  const [row] = await db
    .select({ booking: bookings, user: users })
    .from(bookings)
    .innerJoin(users, eq(users.id, bookings.userId))
    .where(eq(bookings.id, bookingId));
  if (row === undefined) throw notFound();
  return {
    ...(await loadBookingDetail(db, row.booking, now, registry)),
    customer: {
      id: row.user.id,
      name: row.user.name,
      email: row.user.email,
      phone: row.user.phone,
    },
  };
}

// --- CSV --------------------------------------------------------------------------------------------

const SOURCE_LABEL: Record<string, string> = {
  web: 'Site',
  app: 'App',
  admin: 'Recepção',
  mcp: 'MCP',
};

/** "219,00": reais with a comma and no thousands separator, as Brazilian Excel reads it. */
const reais = (cents: number) =>
  `${String(Math.trunc(cents / 100))},${String(cents % 100).padStart(2, '0')}`;

/** Quotes a cell that holds `;`, quotes or line breaks, and defuses spreadsheet formulas. */
function cell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[;"\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

const CSV_HEADER =
  'Código;Cliente;E-mail;Sala;Início;Fim;Status;Total (R$);Pago (R$);Saldo (R$);Origem';

/**
 * `GET /admin/bookings/export.csv` (NUC-178): UTF-8 with BOM, `;` separated, São Paulo dates and
 * pt-BR amounts; more than 5 000 matching rows is a 422.
 */
export async function exportBookingsCsv(db: Db, filters: BookingListFilters): Promise<string> {
  const rows = await db
    .select({
      booking: bookings,
      roomName: rooms.name,
      customerName: users.name,
      customerEmail: users.email,
    })
    .from(bookings)
    .innerJoin(rooms, eq(rooms.id, bookings.roomId))
    .innerJoin(users, eq(users.id, bookings.userId))
    .where(and(...listConditions(filters)))
    .orderBy(desc(bookings.startsAt), desc(bookings.id))
    .limit(CSV_MAX_ROWS + 1);
  if (rows.length > CSV_MAX_ROWS) {
    throw new AppError(422, 'VALIDATION_FAILED', 'Refine os filtros (máximo de 5.000 linhas).');
  }
  const lines = rows.map(({ booking, roomName, customerName, customerEmail }) =>
    [
      booking.code,
      customerName,
      customerEmail,
      roomName,
      formatDateTimeBR(booking.startsAt),
      formatDateTimeBR(booking.endsAt),
      bookingStatusLabel[booking.status as BookingStatus],
      reais(booking.totalCents),
      reais(booking.paidCents),
      reais(booking.balanceCents),
      SOURCE_LABEL[booking.source] ?? booking.source,
    ]
      .map(cell)
      .join(';'),
  );
  return `${BOM}${[CSV_HEADER, ...lines].join('\r\n')}\r\n`;
}
