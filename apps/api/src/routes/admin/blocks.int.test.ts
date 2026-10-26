import {
  blockCreateResultSchema,
  blockListSchema,
  blockRecurrenceCreateResultSchema,
  localToUtc,
  type LocalDate,
} from '@bravo/core';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createBooking, createUser, loginAs } from '../../../test/factories';
import { forbiddenFetch, send, testEnv } from '../../../test/http';
import { requireTestDatabaseUrl } from '../../../test/require-test-db';
import { createApp } from '../../app';
import { createDb } from '../../db/client';
import { auditLog, blockRecurrences, blocks, roomOccupancy, rooms } from '../../db/schema';
import { runSeed } from '../../db/seed';
import { materializeRecurrences } from '../../modules/calendar/blocks.service';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

const NOW = new Date('2026-10-20T12:00:00Z');
const TUESDAY = '2026-10-27' as LocalDate;

let principalId = '';
let secondaryId = '';
let customerId = '';
let adminUser: Awaited<ReturnType<typeof createUser>>;
let adminCookie = '';
let receptionCookie = '';

beforeEach(async () => {
  await runSeed(db);
  const roomRows = await db.select().from(rooms);
  principalId = roomRows.find((r) => r.slug === 'principal')?.id ?? '';
  secondaryId = roomRows.find((r) => r.slug === 'secundaria')?.id ?? '';
  customerId = (await createUser(db)).id;
  adminUser = await createUser(db, { role: 'admin', totp: true });
  adminCookie = await loginAs(db, adminUser, { mfaVerified: true, now: NOW });
  receptionCookie = await loginAs(db, await createUser(db, { role: 'reception', totp: true }), {
    mfaVerified: true,
    now: NOW,
  });
});

const appAt = (now: Date) =>
  createApp({ db, now: () => now, fetch: forbiddenFetch, env: testEnv() });

const call = (method: string, path: string, cookie: string, body?: unknown, now = NOW) =>
  send(appAt(now), method, path, { cookie, ...(body !== undefined && { body }) });

const monday = {
  tag: 'Limpeza semanal',
  weekdays: [1],
  startMinute: 540,
  endMinute: 600,
  validFrom: '2026-10-20',
};

const activeOccupancy = async () => {
  const { rows } = await pool.query<{ ref_id: string; start: Date; until: Date; room_id: string }>(
    `select ref_id, room_id, lower(period) as start, upper(period) as until
     from room_occupancy where kind = 'block' and active order by lower(period), room_id`,
  );
  return rows;
};

describe('POST /admin/blocks (NUC-54, NUC-55, NUC-59)', () => {
  const body = (roomIds: string[]) => ({
    roomIds,
    tag: 'Limpeza',
    date: TUESDAY,
    startMinute: 660,
    endMinute: 720,
  });

  it('creates one block and one [start, end) occupancy per room and audits block.create', async () => {
    const res = await call(
      'POST',
      '/admin/blocks',
      receptionCookie,
      body([principalId, secondaryId]),
    );

    expect(res.status).toBe(201);
    const parsed = blockCreateResultSchema.parse(res.body);
    expect(parsed.items.map((b) => [b.roomId, b.tag, b.startsAt, b.endsAt]).sort()).toEqual(
      [principalId, secondaryId]
        .map((roomId) => [
          roomId,
          'Limpeza',
          '2026-10-27T14:00:00.000Z',
          '2026-10-27T15:00:00.000Z',
        ])
        .sort(),
    );
    const occupancy = await activeOccupancy();
    expect(occupancy.map((o) => [o.start.toISOString(), o.until.toISOString()])).toEqual([
      ['2026-10-27T14:00:00.000Z', '2026-10-27T15:00:00.000Z'],
      ['2026-10-27T14:00:00.000Z', '2026-10-27T15:00:00.000Z'],
    ]);
    expect((await db.select().from(auditLog)).map((a) => a.action)).toEqual([
      'block.create',
      'block.create',
    ]);
  });

  it('returns 409 SLOT_TAKEN naming the booking code when a booking cleanup overlaps one room and creates no block', async () => {
    const booking = await createBooking(db, {
      userId: customerId,
      roomId: principalId,
      startsAt: localToUtc(TUESDAY, 540),
      endsAt: localToUtc(TUESDAY, 660),
    });

    const res = await call('POST', '/admin/blocks', adminCookie, body([secondaryId, principalId]));

    expect([res.status, res.error?.code]).toEqual([409, 'SLOT_TAKEN']);
    expect(res.error?.message).toContain(booking.code);
    expect(await db.select().from(blocks)).toEqual([]);
    expect(await activeOccupancy()).toEqual([]);
  });

  it('lists blocks of a period and frees the slot when a block is deleted (NUC-58)', async () => {
    const created = blockCreateResultSchema.parse(
      (await call('POST', '/admin/blocks', adminCookie, body([principalId]))).body,
    );
    const id = created.items[0]?.id ?? '';
    const listed = await call(
      'GET',
      `/admin/blocks?from=${TUESDAY}&to=${TUESDAY}`,
      receptionCookie,
    );

    const removed = await call('DELETE', `/admin/blocks/${id}`, receptionCookie);
    const again = await call('POST', '/admin/blocks', adminCookie, body([principalId]));

    expect(blockListSchema.parse(listed.body).items.map((b) => b.id)).toEqual([id]);
    expect(removed.status).toBe(204);
    const [row] = await db.select().from(blocks).where(eq(blocks.id, id));
    expect(row?.cancelledAt).not.toBeNull();
    const [occupancy] = await db.select().from(roomOccupancy).where(eq(roomOccupancy.refId, id));
    expect(occupancy?.active).toBe(false);
    expect(again.status).toBe(201);
    expect((await call('DELETE', `/admin/blocks/${id}`, adminCookie)).status).toBe(404);
  });
});

describe('block recurrences (NUC-56, NUC-57, NUC-58)', () => {
  const create = (extra: Record<string, unknown> = {}, cookie = adminCookie) =>
    call('POST', '/admin/block-recurrences', cookie, {
      roomIds: [principalId],
      ...monday,
      ...extra,
    });

  it('answers reception with 403 FORBIDDEN on every recurrence route', async () => {
    const results = await Promise.all([
      call('GET', '/admin/block-recurrences', receptionCookie),
      create({}, receptionCookie),
      call(
        'DELETE',
        '/admin/block-recurrences/3f2b8c6e-1a4d-4e5f-8a9b-0c1d2e3f4a5b',
        receptionCookie,
      ),
    ]);

    expect(results.map((r) => [r.status, r.error?.code])).toEqual([
      [403, 'FORBIDDEN'],
      [403, 'FORBIDDEN'],
      [403, 'FORBIDDEN'],
    ]);
  });

  it('materializes a weekly Monday rule up to today + 90 days (13 Mondays)', async () => {
    const res = await create();

    expect(res.status).toBe(201);
    const parsed = blockRecurrenceCreateResultSchema.parse(res.body);
    expect([parsed.created, parsed.skipped, parsed.items[0]?.roomId]).toEqual([
      13,
      [],
      principalId,
    ]);
    const rows = await db.select().from(blocks).orderBy(blocks.startsAt);
    expect(rows).toHaveLength(13);
    expect([rows[0]?.startsAt.toISOString(), rows.at(-1)?.startsAt.toISOString()]).toEqual([
      '2026-10-26T12:00:00.000Z',
      '2027-01-18T12:00:00.000Z',
    ]);
  });

  async function bookMondayNov9() {
    await createBooking(db, {
      userId: customerId,
      roomId: principalId,
      startsAt: localToUtc('2026-11-09', 570),
      endsAt: localToUtc('2026-11-09', 630),
    });
  }

  it('returns 409 SLOT_TAKEN with details.dates for a conflicting date and creates nothing', async () => {
    await bookMondayNov9();

    const res = await create();

    expect([res.status, res.error?.code]).toEqual([409, 'SLOT_TAKEN']);
    expect((res.error?.details as unknown as { dates: string[] }).dates).toEqual(['2026-11-09']);
    expect(await db.select().from(blockRecurrences)).toEqual([]);
    expect(await db.select().from(blocks)).toEqual([]);
  });

  it('skips the conflicting date and reports it in skipped[] when skipConflicts is true', async () => {
    await bookMondayNov9();

    const res = await create({ skipConflicts: true });

    const parsed = blockRecurrenceCreateResultSchema.parse(res.body);
    expect([parsed.created, parsed.skipped]).toEqual([
      12,
      [{ roomId: principalId, date: '2026-11-09' }],
    ]);
  });

  it('creates no duplicates on a second materialization and extends the horizon as now advances', async () => {
    await create();

    const again = await materializeRecurrences(db, NOW);
    const later = await materializeRecurrences(db, new Date('2026-10-27T12:00:00Z'));

    expect(again).toEqual({ created: 0, skipped: 0 });
    expect(later).toEqual({ created: 1, skipped: 0 });
    const rows = await db.select().from(blocks).orderBy(blocks.startsAt);
    expect([rows.length, rows.at(-1)?.startsAt.toISOString()]).toEqual([
      14,
      '2027-01-25T12:00:00.000Z',
    ]);
  });

  it('counts a conflicting date as skipped when the job runs', async () => {
    await bookMondayNov9();
    await create({ skipConflicts: true });

    const stats = await materializeRecurrences(db, NOW);

    expect(stats).toEqual({ created: 0, skipped: 1 });
  });

  it('cancels the future blocks of a deleted rule, keeps past ones and deactivates the rule', async () => {
    const created = blockRecurrenceCreateResultSchema.parse((await create()).body);
    const id = created.items[0]?.id ?? '';

    const later = new Date('2026-11-10T12:00:00Z');
    const laterCookie = await loginAs(db, adminUser, { mfaVerified: true, now: later });

    const res = await call(
      'DELETE',
      `/admin/block-recurrences/${id}`,
      laterCookie,
      undefined,
      later,
    );

    expect(res.status).toBe(204);
    const rows = await db.select().from(blocks);
    expect(
      rows
        .filter((b) => b.cancelledAt === null)
        .map((b) => b.startsAt.toISOString())
        .sort(),
    ).toEqual(['2026-10-26T12:00:00.000Z', '2026-11-02T12:00:00.000Z', '2026-11-09T12:00:00.000Z']);
    expect(rows.filter((b) => b.cancelledAt !== null)).toHaveLength(10);
    expect(await activeOccupancy()).toHaveLength(3);
    const [rule] = await db.select().from(blockRecurrences);
    expect(rule?.active).toBe(false);
  });
});
