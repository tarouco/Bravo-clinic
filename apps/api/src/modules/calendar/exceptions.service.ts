import {
  diffDays,
  utcToLocal,
  type AffectedBooking,
  type Holiday,
  type LocalDate,
} from '@bravo/core';
import { and, asc, between, eq, inArray } from 'drizzle-orm';
import type { Db, Tx } from '../../db/client';
import { closedDays, holidays, rooms } from '../../db/schema';
import type { CompensationSummary, Registry } from '../../extensions/registry';
import { audit, type RequestContext } from '../../lib/audit';
import { AppError, conflict, notFound } from '../../lib/errors';
import { findAffectedBookings } from '../availability/availability.service';
import { affectedBookingsError } from './calendar-config.service';
import { lockCalendarDate } from './calendar-lock';

type HolidayRow = typeof holidays.$inferSelect;

const ALERT_DAYS = 30;

function holidayView(row: HolidayRow, today: LocalDate): Holiday {
  const days = diffDays(today, row.date as LocalDate);
  return {
    id: row.id,
    date: row.date as LocalDate,
    name: row.name,
    scope: row.scope as Holiday['scope'],
    source: row.source as Holiday['source'],
    isClosed: row.isClosed,
    needsReview: row.needsReview,
    alert: days >= 0 && days <= ALERT_DAYS,
  };
}

const validation = (path: string, message: string) =>
  new AppError(422, 'VALIDATION_FAILED', 'Dados inválidos', [{ path, message }]);

/** NUC-43: the year's holidays by date; `alert` marks dates within today..today+30. */
export async function listHolidays(db: Db, year: number, now: Date): Promise<Holiday[]> {
  const rows = await db
    .select()
    .from(holidays)
    .where(between(holidays.date, `${String(year)}-01-01`, `${String(year)}-12-31`))
    .orderBy(asc(holidays.date), asc(holidays.name));
  const today = utcToLocal(now).date;
  return rows.map((row) => holidayView(row, today));
}

export async function createHoliday(
  tx: Tx,
  input: { date: LocalDate; name: string; scope: Holiday['scope'] },
  ctx: RequestContext,
  now: Date,
): Promise<Holiday> {
  const [row] = await tx
    .insert(holidays)
    .values({ ...input, source: 'manual' })
    .onConflictDoNothing()
    .returning();
  if (row === undefined) {
    throw conflict('CONFLICT', 'Já existe um feriado com este nome nesta data.');
  }
  await audit(tx, ctx, {
    action: 'holiday.create',
    entityType: 'holiday',
    entityId: row.id,
    after: input,
  });
  return holidayView(row, utcToLocal(now).date);
}

/** NUC-44: closing a holiday with active bookings that day is a 409 listing them. */
export async function updateHoliday(
  tx: Tx,
  id: string,
  patch: {
    isClosed?: boolean | undefined;
    name?: string | undefined;
    needsReview?: boolean | undefined;
  },
  ctx: RequestContext,
  now: Date,
): Promise<Holiday> {
  const [before] = await tx.select().from(holidays).where(eq(holidays.id, id));
  if (before === undefined) throw notFound();
  const date = before.date as LocalDate;

  if (patch.isClosed === true && !before.isClosed) {
    await lockCalendarDate(tx, date);
    const affected = await findAffectedBookings(tx, { from: now, dates: [date] });
    if (affected.length > 0) throw affectedBookingsError(affected);
  }
  const changes = {
    ...(patch.isClosed !== undefined && { isClosed: patch.isClosed }),
    ...(patch.name !== undefined && { name: patch.name }),
    ...(patch.needsReview !== undefined && { needsReview: patch.needsReview }),
  };
  const [after] = await tx
    .update(holidays)
    .set({ ...changes, updatedAt: new Date() })
    .where(eq(holidays.id, id))
    .returning();
  if (after === undefined) throw notFound();
  await audit(tx, ctx, {
    action: 'holiday.update',
    entityType: 'holiday',
    entityId: id,
    before: { name: before.name, isClosed: before.isClosed, needsReview: before.needsReview },
    after: { name: after.name, isClosed: after.isClosed, needsReview: after.needsReview },
  });
  return holidayView(after, utcToLocal(now).date);
}

/** NUC-45: only manual holidays can be deleted. */
export async function deleteHoliday(tx: Tx, id: string, ctx: RequestContext): Promise<void> {
  const [row] = await tx.select().from(holidays).where(eq(holidays.id, id));
  if (row === undefined) throw notFound();
  if (row.source !== 'manual') {
    throw validation('source', 'Feriados padrão não podem ser removidos; feche-os se necessário');
  }
  await tx.delete(holidays).where(eq(holidays.id, id));
  await audit(tx, ctx, {
    action: 'holiday.delete',
    entityType: 'holiday',
    entityId: id,
    before: { date: row.date, name: row.name, scope: row.scope },
  });
}

// ---- closed days ----

export interface ClosedDayItem {
  id: string;
  date: LocalDate;
  roomId: string | null;
  roomName: string | null;
  reason: string | null;
}

export async function listClosedDays(
  db: Db,
  from: LocalDate,
  to: LocalDate,
): Promise<ClosedDayItem[]> {
  const rows = await db
    .select({
      id: closedDays.id,
      date: closedDays.date,
      roomId: closedDays.roomId,
      roomName: rooms.name,
      reason: closedDays.reason,
    })
    .from(closedDays)
    .leftJoin(rooms, eq(rooms.id, closedDays.roomId))
    .where(between(closedDays.date, from, to))
    .orderBy(asc(closedDays.date));
  return rows.map((row) => ({ ...row, date: row.date as LocalDate }));
}

async function assertClosableDate(
  db: Db | Tx,
  date: LocalDate,
  roomIds: string[] | null,
  now: Date,
) {
  if (date < utcToLocal(now).date)
    throw validation('date', 'Não é possível fechar uma data passada');
  if (roomIds !== null) {
    const found = await db.select({ id: rooms.id }).from(rooms).where(inArray(rooms.id, roomIds));
    if (found.length !== new Set(roomIds).size) throw validation('roomIds', 'Sala não encontrada');
  }
}

export interface ClosedDayPreview {
  affectedBookings: AffectedBooking[];
  compensation: CompensationSummary;
}

/** NUC-48: bookings a closure would hit (fixed occurrences are the compensation port's) plus its numbers. */
export async function previewClosedDay(
  db: Db | Tx,
  input: { date: LocalDate; roomIds: string[] | null },
  registry: Pick<Registry, 'closedDayCompensation'>,
  now: Date,
): Promise<ClosedDayPreview> {
  await assertClosableDate(db, input.date, input.roomIds, now);
  const [affectedBookings, compensation] = await Promise.all([
    findAffectedBookings(db, { from: now, dates: [input.date], roomIds: input.roomIds }),
    registry.closedDayCompensation.preview(db, input),
  ]);
  return { affectedBookings, compensation };
}

/**
 * NUC-49, NUC-51: closes a date for the whole clinic (`roomIds: null`) or for rooms. The date lock
 * makes a concurrent booking either appear as affected or be rejected as closed.
 */
export async function createClosedDays(
  tx: Tx,
  input: { date: LocalDate; roomIds: string[] | null; reason?: string | undefined },
  ctx: RequestContext,
  registry: Pick<Registry, 'closedDayCompensation'>,
  now: Date,
): Promise<{ items: ClosedDayItem[]; compensation: CompensationSummary }> {
  await assertClosableDate(tx, input.date, input.roomIds, now);
  await lockCalendarDate(tx, input.date);
  const affected = await findAffectedBookings(tx, {
    from: now,
    dates: [input.date],
    roomIds: input.roomIds,
  });
  if (affected.length > 0) throw affectedBookingsError(affected);

  const compensation = await registry.closedDayCompensation.preview(tx, input);
  const targets = input.roomIds === null ? [null] : [...new Set(input.roomIds)];
  const created = await tx
    .insert(closedDays)
    .values(
      targets.map((roomId) => ({
        date: input.date,
        roomId,
        reason: input.reason ?? null,
        createdBy: ctx.actorUserId,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: closedDays.id });
  if (created.length !== targets.length) {
    throw conflict('CONFLICT', 'Esta data já está fechada.');
  }
  const ids = created.map((row) => row.id);
  await registry.closedDayCompensation.apply(tx, ids, ctx);
  for (const id of ids) {
    await audit(tx, ctx, {
      action: 'closed_day.create',
      entityType: 'closed_day',
      entityId: id,
      after: { date: input.date, reason: input.reason ?? null },
    });
  }
  const items = await tx
    .select({
      id: closedDays.id,
      date: closedDays.date,
      roomId: closedDays.roomId,
      roomName: rooms.name,
      reason: closedDays.reason,
    })
    .from(closedDays)
    .leftJoin(rooms, eq(rooms.id, closedDays.roomId))
    .where(inArray(closedDays.id, ids));
  return { items: items.map((row) => ({ ...row, date: row.date as LocalDate })), compensation };
}

/** NUC-50: reopening a date. */
export async function deleteClosedDay(tx: Tx, id: string, ctx: RequestContext): Promise<void> {
  const [row] = await tx.select().from(closedDays).where(eq(closedDays.id, id));
  if (row === undefined) throw notFound();
  await tx.delete(closedDays).where(and(eq(closedDays.id, id)));
  await audit(tx, ctx, {
    action: 'closed_day.delete',
    entityType: 'closed_day',
    entityId: id,
    before: { date: row.date, roomId: row.roomId, reason: row.reason },
  });
}
