import {
  addDays,
  localToUtc,
  utcToLocal,
  type LocalDate,
  type SlotDiscount,
  type SlotDiscountApplyResult,
  type SlotDiscountInput,
} from '@bravo/core';
import { and, asc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import type { Db, Tx } from '../../db/client';
import { rooms, slotDiscounts } from '../../db/schema';
import { audit, type RequestContext } from '../../lib/audit';
import { AppError, notFound, sqlStateOf, validationFailed } from '../../lib/errors';
import { loadDayContexts } from '../calendar/calendar.repo';
import { loadSettings } from '../settings/settings.repo';

// Slot discounts (PRD §5.3.3, REC-133..REC-141). A discount covers only free time of a room; the
// part a confirmed booking overlaps is marked consumed and the rest stays active (REC-138).

interface DiscountRow {
  id: string;
  roomId: string;
  startsAt: Date;
  endsAt: Date;
  percent: number;
  consumedByBookingId: string | null;
  createdBy: string | null;
}

const columns = {
  id: slotDiscounts.id,
  roomId: slotDiscounts.roomId,
  startsAt: sql<Date>`lower(${slotDiscounts.period})`.mapWith((v: string) => new Date(v)),
  endsAt: sql<Date>`upper(${slotDiscounts.period})`.mapWith((v: string) => new Date(v)),
  percent: slotDiscounts.percent,
  consumedByBookingId: slotDiscounts.consumedByBookingId,
  createdBy: slotDiscounts.createdBy,
};

const range = (start: Date, end: Date) => `[${start.toISOString()},${end.toISOString()})`;
const overlaps = (start: Date, end: Date): SQL =>
  sql`${slotDiscounts.period} && tstzrange(${start.toISOString()}::timestamptz, ${end.toISOString()}::timestamptz, '[)')`;

export const toSlotDiscount = (row: DiscountRow): SlotDiscount => ({
  id: row.id,
  roomId: row.roomId,
  startsAt: row.startsAt.toISOString(),
  endsAt: row.endsAt.toISOString(),
  percent: row.percent,
  consumed: row.consumedByBookingId !== null,
});

const overlapConflict = () => new AppError(409, 'CONFLICT', 'Já existe desconto neste horário');

/** `[from, to)` minus the occupied intervals, as minute-of-day pieces of `date`. */
function freeParts(
  date: LocalDate,
  from: number,
  to: number,
  occupied: { start: Date; occupiedUntil: Date }[],
): { free: [number, number][]; busy: [number, number][] } {
  const dayStart = localToUtc(date, 0).getTime();
  const minuteOf = (instant: Date) => Math.round((instant.getTime() - dayStart) / 60_000);
  const busy = occupied
    .map(
      (o) =>
        [Math.max(from, minuteOf(o.start)), Math.min(to, minuteOf(o.occupiedUntil))] as [
          number,
          number,
        ],
    )
    .filter(([a, b]) => b > a)
    .sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const piece of busy) {
    const last = merged.at(-1);
    if (last !== undefined && piece[0] <= last[1]) last[1] = Math.max(last[1], piece[1]);
    else merged.push([...piece]);
  }
  const free: [number, number][] = [];
  let cursor = from;
  for (const [a, b] of merged) {
    if (a > cursor) free.push([cursor, a]);
    cursor = Math.max(cursor, b);
  }
  if (cursor < to) free.push([cursor, to]);
  return { free, busy: merged };
}

/**
 * Creates one discount per free sub-interval of each room (REC-133). Misaligned, past, outside the
 * business window or not a room → 422 (REC-134); overlap with an active discount → 409 (REC-135).
 */
export async function applyDiscount(
  tx: Tx,
  ctx: RequestContext,
  input: SlotDiscountInput,
  now: Date,
): Promise<SlotDiscountApplyResult> {
  const settings = await loadSettings(tx);
  const slot = settings['calendar.slot_minutes'];
  const issues: { path: string[]; message: string }[] = [];
  if (input.startMinute % slot !== 0) {
    issues.push({
      path: ['startMinute'],
      message: `Use horários da grade de ${String(slot)} minutos`,
    });
  }
  if (input.endMinute % slot !== 0) {
    issues.push({
      path: ['endMinute'],
      message: `Use horários da grade de ${String(slot)} minutos`,
    });
  }
  const startsAt = localToUtc(input.date, input.startMinute);
  if (startsAt.getTime() <= now.getTime()) {
    issues.push({ path: ['startMinute'], message: 'Escolha um horário que ainda não começou' });
  }
  if (issues.length > 0) throw validationFailed(issues);

  const found = await tx
    .select({ id: rooms.id })
    .from(rooms)
    .where(inArray(rooms.id, input.roomIds));
  if (found.length !== input.roomIds.length) {
    throw validationFailed([{ path: ['roomIds'], message: 'Sala não encontrada' }]);
  }

  const created: SlotDiscount[] = [];
  const skipped: SlotDiscountApplyResult['skipped'] = [];
  for (const roomId of [...input.roomIds].sort()) {
    const day = (await loadDayContexts(tx, { roomId, dates: [input.date], now })).get(input.date);
    const window = day?.window ?? null;
    if (
      window === null ||
      input.startMinute < window.openMinute ||
      input.endMinute > window.closeMinute
    ) {
      throw validationFailed([
        { path: ['startMinute'], message: 'O horário está fora do funcionamento da clínica' },
      ]);
    }
    const { free, busy } = freeParts(
      input.date,
      input.startMinute,
      input.endMinute,
      day?.occupied ?? [],
    );
    for (const [a, b] of busy)
      skipped.push({ roomId, startMinute: a, endMinute: b, reason: 'occupied' });
    for (const [a, b] of free) {
      let row: DiscountRow | undefined;
      try {
        [row] = await tx
          .insert(slotDiscounts)
          .values({
            roomId,
            period: range(localToUtc(input.date, a), localToUtc(input.date, b)),
            percent: input.percent,
            createdBy: ctx.actorUserId,
            createdAt: now,
          })
          .returning(columns);
      } catch (error) {
        if (sqlStateOf(error) === '23P01') throw overlapConflict();
        throw error;
      }
      if (row === undefined) throw new Error('applyDiscount: insert returned no row');
      created.push(toSlotDiscount(row));
    }
  }
  await audit(tx, ctx, {
    action: 'slot_discount.create',
    entityType: 'slot_discount',
    after: { ...input, created: created.map((d) => d.id) },
  });
  return { created, skipped };
}

/**
 * Not-removed discounts of local dates `[from, to]` (inclusive `to`) still ending after now
 * (REC-140); consumed parts are listed with `consumed: true`.
 */
export async function listDiscounts(
  db: Db | Tx,
  args: { from: LocalDate; to: LocalDate; roomId?: string; now: Date },
): Promise<SlotDiscount[]> {
  const rows = await db
    .select(columns)
    .from(slotDiscounts)
    .where(
      and(
        isNull(slotDiscounts.removedAt),
        args.roomId === undefined ? undefined : eq(slotDiscounts.roomId, args.roomId),
        overlaps(localToUtc(args.from, 0), localToUtc(addDays(args.to, 1), 0)),
        sql`upper(${slotDiscounts.period}) > ${args.now.toISOString()}::timestamptz`,
      ),
    )
    .orderBy(asc(sql`lower(${slotDiscounts.period})`), asc(slotDiscounts.roomId));
  return rows.map(toSlotDiscount);
}

/** Sets `removed_at` (REC-139) and audits `slot_discount.remove`; a removed one is a 404. */
export async function removeDiscount(
  tx: Tx,
  ctx: RequestContext,
  id: string,
  now: Date,
): Promise<void> {
  const [row] = await tx
    .update(slotDiscounts)
    .set({ removedAt: now })
    .where(and(eq(slotDiscounts.id, id), isNull(slotDiscounts.removedAt)))
    .returning(columns);
  if (row === undefined) throw notFound('NOT_FOUND', 'Desconto não encontrado');
  await audit(tx, ctx, {
    action: 'slot_discount.remove',
    entityType: 'slot_discount',
    entityId: id,
    before: toSlotDiscount(row),
  });
}

/** Active (not removed, not consumed, ending after now) discounts overlapping `[startsAt, endsAt)`. */
export function activeFor(
  db: Db | Tx,
  args: { roomId: string; startsAt: Date; endsAt: Date; now: Date },
): Promise<DiscountRow[]> {
  return db
    .select(columns)
    .from(slotDiscounts)
    .where(
      and(
        eq(slotDiscounts.roomId, args.roomId),
        isNull(slotDiscounts.removedAt),
        isNull(slotDiscounts.consumedByBookingId),
        overlaps(args.startsAt, args.endsAt),
        sql`upper(${slotDiscounts.period}) > ${args.now.toISOString()}::timestamptz`,
      ),
    )
    .orderBy(asc(sql`lower(${slotDiscounts.period})`));
}

/**
 * At confirmation (REC-138): the part of each active discount the booking overlaps becomes consumed
 * by it and the parts before and after stay active as new rows. Returns the consumed ids.
 */
export async function consumeForBooking(
  tx: Tx,
  booking: { id: string; roomId: string; startsAt: Date; endsAt: Date },
  now: Date,
): Promise<string[]> {
  const parts = await tx
    .select(columns)
    .from(slotDiscounts)
    .where(
      and(
        eq(slotDiscounts.roomId, booking.roomId),
        isNull(slotDiscounts.removedAt),
        isNull(slotDiscounts.consumedByBookingId),
        overlaps(booking.startsAt, booking.endsAt),
      ),
    )
    .orderBy(asc(slotDiscounts.id))
    .for('update');
  const consumed: string[] = [];
  for (const part of parts) {
    const start = new Date(Math.max(part.startsAt.getTime(), booking.startsAt.getTime()));
    const end = new Date(Math.min(part.endsAt.getTime(), booking.endsAt.getTime()));
    await tx
      .update(slotDiscounts)
      .set({ period: range(start, end), consumedByBookingId: booking.id })
      .where(eq(slotDiscounts.id, part.id));
    const rest: [Date, Date][] = [];
    if (part.startsAt < start) rest.push([part.startsAt, start]);
    if (end < part.endsAt) rest.push([end, part.endsAt]);
    for (const [a, b] of rest) {
      await tx.insert(slotDiscounts).values({
        roomId: part.roomId,
        period: range(a, b),
        percent: part.percent,
        createdBy: part.createdBy,
        createdAt: now,
      });
    }
    consumed.push(part.id);
  }
  return consumed;
}

/** Minute-of-day pieces of the active discounts on one local date (pricing and the public grid). */
export async function discountMinutes(
  db: Db | Tx,
  args: { roomId: string; date: LocalDate; now: Date },
): Promise<{ id: string; startMinute: number; endMinute: number; percent: number }[]> {
  const dayStart = localToUtc(args.date, 0);
  const dayEnd = localToUtc(addDays(args.date, 1), 0);
  const rows = await activeFor(db, {
    roomId: args.roomId,
    startsAt: dayStart,
    endsAt: dayEnd,
    now: args.now,
  });
  const minuteOf = (instant: Date) => utcToLocal(instant).minuteOfDay;
  return rows.map((row) => ({
    id: row.id,
    startMinute: row.startsAt <= dayStart ? 0 : minuteOf(row.startsAt),
    endMinute: row.endsAt >= dayEnd ? 1440 : minuteOf(row.endsAt),
    percent: row.percent,
  }));
}
