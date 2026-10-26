import { addDays, diffDays, localToUtc, utcToLocal, weekdayOf, type LocalDate } from '@bravo/core';
import { and, asc, eq, gt, inArray, isNull, lt, sql } from 'drizzle-orm';
import { withTransaction, type Db, type Tx } from '../../db/client';
import { blockRecurrences, blocks, bookings, roomOccupancy, rooms } from '../../db/schema';
import { audit, type RequestContext } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { loadSettings } from '../settings/settings.repo';
import { lockCalendarDates } from './calendar-lock';

type BlockRow = typeof blocks.$inferSelect;
type RecurrenceRow = typeof blockRecurrences.$inferSelect;

export interface BlockItem {
  id: string;
  roomId: string;
  tag: string;
  startsAt: string;
  endsAt: string;
  recurrenceId: string | null;
}

export interface RecurrenceItem {
  id: string;
  roomId: string;
  tag: string;
  weekdays: number[];
  startMinute: number;
  endMinute: number;
  validFrom: LocalDate;
  validUntil: LocalDate | null;
  active: boolean;
}

const blockItem = (row: BlockRow): BlockItem => ({
  id: row.id,
  roomId: row.roomId,
  tag: row.tag,
  startsAt: row.startsAt.toISOString(),
  endsAt: row.endsAt.toISOString(),
  recurrenceId: row.recurrenceId,
});

const recurrenceItem = (row: RecurrenceRow): RecurrenceItem => ({
  id: row.id,
  roomId: row.roomId,
  tag: row.tag,
  weekdays: row.weekdays,
  startMinute: row.startMinute,
  endMinute: row.endMinute,
  validFrom: row.validFrom as LocalDate,
  validUntil: row.validUntil as LocalDate | null,
  active: row.active,
});

const periodOf = (startsAt: Date, endsAt: Date) =>
  `[${startsAt.toISOString()},${endsAt.toISOString()})`;

/** Inserts a block and its exact `[start, end)` occupancy (NUC-59); the exclusion constraint guards overlaps. */
async function insertBlock(tx: Tx, row: typeof blocks.$inferInsert): Promise<BlockRow | null> {
  const [block] = await tx.insert(blocks).values(row).onConflictDoNothing().returning();
  if (block === undefined) return null;
  await tx.insert(roomOccupancy).values({
    roomId: block.roomId,
    period: periodOf(block.startsAt, block.endsAt),
    kind: 'block',
    refId: block.id,
  });
  return block;
}

interface Occupant {
  roomId: string;
  start: Date;
  end: Date;
  label: string;
}

/** Active occupancy of the rooms overlapping `[from, to)`, labelled with the booking code or block tag. */
async function occupantsBetween(
  tx: Tx | Db,
  roomIds: string[],
  from: Date,
  to: Date,
): Promise<Occupant[]> {
  const rows = await tx
    .select({
      roomId: roomOccupancy.roomId,
      start: sql<Date>`lower(${roomOccupancy.period})`,
      end: sql<Date>`upper(${roomOccupancy.period})`,
      code: bookings.code,
      tag: blocks.tag,
    })
    .from(roomOccupancy)
    .leftJoin(
      bookings,
      and(eq(roomOccupancy.kind, 'booking'), eq(bookings.id, roomOccupancy.refId)),
    )
    .leftJoin(blocks, and(eq(roomOccupancy.kind, 'block'), eq(blocks.id, roomOccupancy.refId)))
    .where(
      and(
        inArray(roomOccupancy.roomId, roomIds),
        eq(roomOccupancy.active, true),
        sql`${roomOccupancy.period} && tstzrange(${from.toISOString()}::timestamptz, ${to.toISOString()}::timestamptz, '[)')`,
      ),
    );
  return rows.map((row) => ({
    roomId: row.roomId,
    start: new Date(row.start),
    end: new Date(row.end),
    label: row.code ?? row.tag ?? 'ocupação',
  }));
}

const overlaps = (o: Occupant, start: Date, end: Date) => o.start < end && o.end > start;

async function assertRoomsExist(tx: Tx | Db, roomIds: string[]): Promise<void> {
  const found = await tx.select({ id: rooms.id }).from(rooms).where(inArray(rooms.id, roomIds));
  if (found.length !== new Set(roomIds).size) {
    throw new AppError(422, 'VALIDATION_FAILED', 'Dados inválidos', [
      { path: 'roomIds', message: 'Sala não encontrada' },
    ]);
  }
}

export async function listBlocks(
  db: Db,
  args: { from: LocalDate; to: LocalDate; roomId?: string | undefined },
): Promise<BlockItem[]> {
  const rows = await db
    .select()
    .from(blocks)
    .where(
      and(
        isNull(blocks.cancelledAt),
        gt(blocks.endsAt, localToUtc(args.from, 0)),
        lt(blocks.startsAt, localToUtc(args.to, 1440)),
        args.roomId === undefined ? undefined : eq(blocks.roomId, args.roomId),
      ),
    )
    .orderBy(asc(blocks.startsAt));
  return rows.map(blockItem);
}

/**
 * One block per room, all or nothing (NUC-54, NUC-55): a room that already has an active
 * occupancy in the interval fails the whole request with 409 naming the booking code or tag.
 */
export async function createBlocks(
  tx: Tx,
  input: {
    roomIds: string[];
    tag: string;
    date: LocalDate;
    startMinute: number;
    endMinute: number;
  },
  ctx: RequestContext,
): Promise<BlockItem[]> {
  const roomIds = [...new Set(input.roomIds)];
  await assertRoomsExist(tx, roomIds);
  await lockCalendarDates(tx, [input.date]);
  const startsAt = localToUtc(input.date, input.startMinute);
  const endsAt = localToUtc(input.date, input.endMinute);

  const conflicts = (await occupantsBetween(tx, roomIds, startsAt, endsAt)).filter((o) =>
    overlaps(o, startsAt, endsAt),
  );
  if (conflicts.length > 0) {
    const names = [...new Set(conflicts.map((c) => c.label))].join(', ');
    throw new AppError(409, 'SLOT_TAKEN', `Horário já ocupado: ${names}`, {
      conflicts: conflicts.map((c) => ({ roomId: c.roomId, label: c.label })),
    });
  }

  const created: BlockItem[] = [];
  for (const roomId of roomIds) {
    const block = await insertBlock(tx, {
      roomId,
      tag: input.tag,
      startsAt,
      endsAt,
      createdBy: ctx.actorUserId,
    });
    if (block === null) continue;
    created.push(blockItem(block));
    await audit(tx, ctx, {
      action: 'block.create',
      entityType: 'block',
      entityId: block.id,
      after: { roomId, tag: input.tag, startsAt, endsAt },
    });
  }
  return created;
}

/** NUC-58: cancels the block and frees its occupancy. */
export async function deleteBlock(
  tx: Tx,
  id: string,
  ctx: RequestContext,
  now: Date = new Date(),
): Promise<void> {
  const [block] = await tx
    .update(blocks)
    .set({ cancelledAt: now })
    .where(and(eq(blocks.id, id), isNull(blocks.cancelledAt)))
    .returning();
  if (block === undefined) throw notFound();
  await tx
    .update(roomOccupancy)
    .set({ active: false, updatedAt: now })
    .where(and(eq(roomOccupancy.kind, 'block'), eq(roomOccupancy.refId, id)));
  await audit(tx, ctx, {
    action: 'block.delete',
    entityType: 'block',
    entityId: id,
    before: {
      roomId: block.roomId,
      tag: block.tag,
      startsAt: block.startsAt,
      endsAt: block.endsAt,
    },
  });
}

/**
 * System block that holds a slot, e.g. "Reagendamento em pagamento" (NUC-146); an overlap raises
 * the exclusion violation, which the API maps to 409 SLOT_TAKEN.
 */
export async function createHoldBlock(
  tx: Tx,
  input: { roomId: string; startsAt: Date; endsAt: Date; tag: string; createdBy?: string | null },
): Promise<BlockRow> {
  const block = await insertBlock(tx, {
    roomId: input.roomId,
    tag: input.tag,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    createdBy: input.createdBy ?? null,
  });
  if (block === null) throw new Error('createHoldBlock: insert returned no row');
  return block;
}

export async function listRecurrences(db: Db): Promise<RecurrenceItem[]> {
  const rows = await db
    .select()
    .from(blockRecurrences)
    .where(eq(blockRecurrences.active, true))
    .orderBy(asc(blockRecurrences.validFrom), asc(blockRecurrences.createdAt));
  return rows.map(recurrenceItem);
}

/**
 * Creates the missing weekly blocks of one rule from today (or `validFrom`) to the horizon.
 * Conflicting dates are returned, never inserted; existing occurrences are kept (unique
 * `(recurrence_id, starts_at)`).
 */
async function materializeRule(
  tx: Tx,
  rule: RecurrenceRow,
  horizon: LocalDate,
  today: LocalDate,
  createdBy: string | null,
): Promise<{ created: BlockRow[]; conflicts: LocalDate[] }> {
  const first = rule.validFrom > today ? (rule.validFrom as LocalDate) : today;
  const lastAllowed =
    rule.validUntil !== null && rule.validUntil < horizon ? rule.validUntil : horizon;
  const dates: LocalDate[] = [];
  for (let offset = 0; offset <= diffDays(first, lastAllowed as LocalDate); offset++) {
    const date = addDays(first, offset);
    if (rule.weekdays.includes(weekdayOf(date))) dates.push(date);
  }
  if (dates.length === 0) return { created: [], conflicts: [] };

  const rangeStart = localToUtc(dates[0] as LocalDate, 0);
  const rangeEnd = localToUtc(dates.at(-1) as LocalDate, 1440);
  const occupants = await occupantsBetween(tx, [rule.roomId], rangeStart, rangeEnd);
  const existing = await tx
    .select({ startsAt: blocks.startsAt })
    .from(blocks)
    .where(and(eq(blocks.recurrenceId, rule.id), isNull(blocks.cancelledAt)));
  const have = new Set(existing.map((b) => b.startsAt.getTime()));

  const created: BlockRow[] = [];
  const conflicts: LocalDate[] = [];
  for (const date of dates) {
    const startsAt = localToUtc(date, rule.startMinute);
    const endsAt = localToUtc(date, rule.endMinute);
    if (have.has(startsAt.getTime())) continue;
    if (occupants.some((o) => overlaps(o, startsAt, endsAt))) {
      conflicts.push(date);
      continue;
    }
    const block = await insertBlock(tx, {
      roomId: rule.roomId,
      tag: rule.tag,
      startsAt,
      endsAt,
      recurrenceId: rule.id,
      createdBy,
    });
    if (block !== null) created.push(block);
  }
  return { created, conflicts };
}

async function horizonOf(tx: Tx | Db, now: Date) {
  const settings = await loadSettings(tx);
  const today = utcToLocal(now).date;
  return { today, horizon: addDays(today, settings['calendar.max_advance_days']) };
}

/**
 * NUC-56: one rule per room, materialized up to `min(validUntil, today + max_advance_days)`.
 * A conflicting date fails the whole request (409 with `details.dates`) unless `skipConflicts`.
 */
export async function createRecurrence(
  tx: Tx,
  input: {
    roomIds: string[];
    tag: string;
    weekdays: number[];
    startMinute: number;
    endMinute: number;
    validFrom: LocalDate;
    validUntil?: LocalDate | undefined;
    skipConflicts?: boolean | undefined;
  },
  ctx: RequestContext,
  now: Date,
): Promise<{
  items: RecurrenceItem[];
  created: number;
  skipped: { roomId: string; date: LocalDate }[];
}> {
  const roomIds = [...new Set(input.roomIds)];
  await assertRoomsExist(tx, roomIds);
  const { today, horizon } = await horizonOf(tx, now);

  const rules = await tx
    .insert(blockRecurrences)
    .values(
      roomIds.map((roomId) => ({
        roomId,
        tag: input.tag,
        weekdays: input.weekdays,
        startMinute: input.startMinute,
        endMinute: input.endMinute,
        validFrom: input.validFrom,
        validUntil: input.validUntil ?? null,
        createdBy: ctx.actorUserId,
      })),
    )
    .returning();

  let created = 0;
  const skipped: { roomId: string; date: LocalDate }[] = [];
  for (const rule of rules) {
    const result = await materializeRule(tx, rule, horizon, today, ctx.actorUserId);
    created += result.created.length;
    skipped.push(...result.conflicts.map((date) => ({ roomId: rule.roomId, date })));
    await audit(tx, ctx, {
      action: 'block_recurrence.create',
      entityType: 'block_recurrence',
      entityId: rule.id,
      after: { ...recurrenceItem(rule), created: result.created.length },
    });
  }
  if (skipped.length > 0 && input.skipConflicts !== true) {
    const dates = [...new Set(skipped.map((s) => s.date))].sort();
    throw new AppError(
      409,
      'SLOT_TAKEN',
      `Há conflitos em ${String(dates.length)} data(s). Nenhum bloqueio foi criado.`,
      { dates, conflicts: skipped },
    );
  }
  return { items: rules.map(recurrenceItem), created, skipped };
}

/**
 * Daily job (NUC-57): extends every active rule to the horizon, skipping conflicting dates and
 * counting them. Re-running creates nothing new.
 */
export async function materializeRecurrences(
  db: Db,
  now: Date,
): Promise<{ created: number; skipped: number }> {
  const { today, horizon } = await horizonOf(db, now);
  const rules = await db.select().from(blockRecurrences).where(eq(blockRecurrences.active, true));
  let created = 0;
  let skipped = 0;
  for (const rule of rules) {
    if (rule.validUntil !== null && rule.validUntil < today) continue;
    const result = await withTransaction(db, (tx) =>
      materializeRule(tx, rule, horizon, today, rule.createdBy),
    );
    created += result.created.length;
    skipped += result.conflicts.length;
  }
  return { created, skipped };
}

/** NUC-58: the rule becomes inactive and its future blocks are cancelled; past blocks stay. */
export async function deleteRecurrence(
  tx: Tx,
  id: string,
  ctx: RequestContext,
  now: Date,
): Promise<void> {
  const [rule] = await tx
    .update(blockRecurrences)
    .set({ active: false, updatedAt: now })
    .where(and(eq(blockRecurrences.id, id), eq(blockRecurrences.active, true)))
    .returning();
  if (rule === undefined) throw notFound();
  const future = await tx
    .update(blocks)
    .set({ cancelledAt: now })
    .where(and(eq(blocks.recurrenceId, id), isNull(blocks.cancelledAt), gt(blocks.startsAt, now)))
    .returning({ id: blocks.id });
  if (future.length > 0) {
    await tx
      .update(roomOccupancy)
      .set({ active: false, updatedAt: now })
      .where(
        and(
          eq(roomOccupancy.kind, 'block'),
          inArray(
            roomOccupancy.refId,
            future.map((b) => b.id),
          ),
        ),
      );
  }
  await audit(tx, ctx, {
    action: 'block_recurrence.delete',
    entityType: 'block_recurrence',
    entityId: id,
    before: recurrenceItem(rule),
    after: { cancelledBlocks: future.length },
  });
}
