import { localToUtc, slotDiscountApplyResultSchema, slotDiscountListSchema } from '@bravo/core';
import { eq, isNull } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createStaff, createTenant, seededRoom } from '../../../test/booking-helpers';
import { createBooking } from '../../../test/factories';
import { forbiddenFetch, send, testEnv } from '../../../test/http';
import { requireTestDatabaseUrl } from '../../../test/require-test-db';
import { createApp } from '../../app';
import { createDb, withTransaction } from '../../db/client';
import { auditLog, blocks, roomOccupancy, slotDiscounts } from '../../db/schema';
import { runSeed } from '../../db/seed';
import { consumeForBooking } from '../../modules/slot-discounts/slot-discounts.service';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

// Monday 2026-11-02 09:00 BRT; the discounts go on Tuesday 2026-11-03.
const NOW = new Date('2026-11-02T12:00:00.000Z');
const TUE = '2026-11-03';
const at = (minute: number) => localToUtc(TUE, minute).toISOString();
const app = () => createApp({ db, now: () => NOW, fetch: forbiddenFetch, env: testEnv() });
const call = (method: string, path: string, cookie: string, body?: unknown) =>
  send(app(), method, path, { cookie, ...(body !== undefined && { body }) });

let rooms: { principal: string; secundaria: string; terceira: string };
let adminCookie = '';

beforeEach(async () => {
  await runSeed(db);
  rooms = {
    principal: (await seededRoom(db, 'principal')).id,
    secundaria: (await seededRoom(db, 'secundaria')).id,
    terceira: (await seededRoom(db, 'terceira')).id,
  };
  adminCookie = (await createStaff(db, 'admin', NOW)).cookie;
});

const evening = (overrides: Record<string, unknown> = {}) => ({
  roomIds: [rooms.principal, rooms.secundaria, rooms.terceira],
  date: TUE,
  startMinute: 1140,
  endMinute: 1320,
  percent: 15,
  ...overrides,
});

async function bookPrincipal(startMinute: number, endMinute: number) {
  const { user } = await createTenant(db);
  return createBooking(db, {
    userId: user.id,
    roomId: rooms.principal,
    startsAt: localToUtc(TUE, startMinute),
    endsAt: localToUtc(TUE, endMinute),
    cleanupMinutes: 30,
  });
}

describe('POST /admin/slot-discounts (REC-133)', () => {
  it('covers only the free parts of each room and reports the occupied part as skipped', async () => {
    await bookPrincipal(1200, 1260);
    const res = await call('POST', '/admin/slot-discounts', adminCookie, evening());
    expect(res.status).toBe(201);
    const body = slotDiscountApplyResultSchema.parse(res.body);
    const parts = (roomId: string) =>
      body.created
        .filter((d) => d.roomId === roomId)
        .map((d) => [d.startsAt, d.endsAt])
        .sort();
    expect(parts(rooms.principal)).toEqual([
      [at(1140), at(1200)],
      [at(1290), at(1320)],
    ]);
    expect(parts(rooms.secundaria)).toEqual([[at(1140), at(1320)]]);
    expect(parts(rooms.terceira)).toEqual([[at(1140), at(1320)]]);
    expect(body.skipped).toEqual([
      { roomId: rooms.principal, startMinute: 1200, endMinute: 1290, reason: 'occupied' },
    ]);
    expect(body.created.every((d) => d.percent === 15 && !d.consumed)).toBe(true);
  });

  it.each([
    ['misaligned start', { startMinute: 1145 }, 'startMinute'],
    [
      'a start in the past',
      { date: '2026-11-02', startMinute: 420, endMinute: 480 },
      'startMinute',
    ],
    ['outside the business window', { startMinute: 360, endMinute: 480 }, 'startMinute'],
    ['percent 0', { percent: 0 }, 'percent'],
  ])('answers 422 VALIDATION_FAILED for %s (REC-134)', async (_name, overrides, path) => {
    const res = await call('POST', '/admin/slot-discounts', adminCookie, evening(overrides));
    expect(res.status).toBe(422);
    expect(res.error?.code).toBe('VALIDATION_FAILED');
    expect(res.error?.details?.[0]?.path).toBe(path);
    expect(await db.select().from(slotDiscounts)).toHaveLength(0);
  });

  it('answers 409 "Já existe desconto neste horário" over an active discount (REC-135)', async () => {
    await call(
      'POST',
      '/admin/slot-discounts',
      adminCookie,
      evening({ roomIds: [rooms.principal] }),
    );
    const res = await call(
      'POST',
      '/admin/slot-discounts',
      adminCookie,
      evening({ roomIds: [rooms.secundaria, rooms.principal], startMinute: 1200, endMinute: 1260 }),
    );
    expect(res.status).toBe(409);
    expect(res.error).toMatchObject({
      code: 'CONFLICT',
      message: 'Já existe desconto neste horário',
    });
    expect(await db.select().from(slotDiscounts)).toHaveLength(1);
  });
});

describe('blocks and auth', () => {
  it('skips a blocked interval like a booking (REC-133)', async () => {
    const [block] = await db
      .insert(blocks)
      .values({
        roomId: rooms.secundaria,
        tag: 'Manutenção',
        startsAt: localToUtc(TUE, 1260),
        endsAt: localToUtc(TUE, 1320),
      })
      .returning();
    await db.insert(roomOccupancy).values({
      roomId: rooms.secundaria,
      period: `[${at(1260)},${at(1320)})`,
      kind: 'block',
      refId: block?.id ?? '',
    });
    const res = await call(
      'POST',
      '/admin/slot-discounts',
      adminCookie,
      evening({ roomIds: [rooms.secundaria] }),
    );
    const body = slotDiscountApplyResultSchema.parse(res.body);
    expect(body.created.map((d) => [d.startsAt, d.endsAt])).toEqual([[at(1140), at(1260)]]);
    expect(body.skipped).toEqual([
      { roomId: rooms.secundaria, startMinute: 1260, endMinute: 1320, reason: 'occupied' },
    ]);
  });

  it('answers 401 without a session', async () => {
    const res = await send(app(), 'GET', `/admin/slot-discounts?from=${TUE}&to=${TUE}`);
    expect(res.status).toBe(401);
  });
});

describe('consumeForBooking (REC-138)', () => {
  it('a 19:00–20:00 booking consumes that part and leaves 20:00–22:00 active', async () => {
    await call(
      'POST',
      '/admin/slot-discounts',
      adminCookie,
      evening({ roomIds: [rooms.principal] }),
    );
    const booking = await bookPrincipal(1140, 1200);
    const consumed = await withTransaction(db, (tx) => consumeForBooking(tx, booking, NOW));
    expect(consumed).toHaveLength(1);
    const list = slotDiscountListSchema.parse(
      (await call('GET', `/admin/slot-discounts?from=${TUE}&to=${TUE}`, adminCookie)).body,
    );
    expect(list.items.map((d) => [d.startsAt, d.endsAt, d.consumed])).toEqual([
      [at(1140), at(1200), true],
      [at(1200), at(1320), false],
    ]);
    const [part] = await db
      .select()
      .from(slotDiscounts)
      .where(eq(slotDiscounts.id, consumed[0] ?? ''));
    expect(part?.consumedByBookingId).toBe(booking.id);
  });
});

describe('DELETE /admin/slot-discounts/:id and GET (REC-139, REC-140)', () => {
  it('removes a discount with removed_at and an audit row; it leaves the list', async () => {
    const created = slotDiscountApplyResultSchema.parse(
      (
        await call(
          'POST',
          '/admin/slot-discounts',
          adminCookie,
          evening({ roomIds: [rooms.principal] }),
        )
      ).body,
    ).created;
    const id = created[0]?.id ?? '';
    const res = await call('DELETE', `/admin/slot-discounts/${id}`, adminCookie);
    expect(res.status).toBe(204);
    const [row] = await db.select().from(slotDiscounts).where(eq(slotDiscounts.id, id));
    expect(row?.removedAt).toEqual(NOW);
    const audits = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'slot_discount.remove'));
    expect(audits.map((a) => a.entityId)).toEqual([id]);
    const list = slotDiscountListSchema.parse(
      (await call('GET', `/admin/slot-discounts?from=${TUE}&to=${TUE}`, adminCookie)).body,
    );
    expect(list.items).toEqual([]);
    const again = await call('DELETE', `/admin/slot-discounts/${id}`, adminCookie);
    expect(again.status).toBe(404);
  });

  it('lists only parts ending after now, filtered by room, with an inclusive `to`', async () => {
    await db.insert(slotDiscounts).values([
      // Ended at 08:00 on Monday, before NOW (09:00).
      {
        roomId: rooms.principal,
        period: `[${localToUtc('2026-11-02', 420).toISOString()},${localToUtc('2026-11-02', 480).toISOString()})`,
        percent: 10,
      },
      {
        roomId: rooms.principal,
        period: `[${localToUtc('2026-11-02', 600).toISOString()},${localToUtc('2026-11-02', 660).toISOString()})`,
        percent: 20,
      },
      {
        roomId: rooms.secundaria,
        period: `[${at(600)},${at(660)})`,
        percent: 30,
      },
    ]);
    const all = slotDiscountListSchema.parse(
      (await call('GET', `/admin/slot-discounts?from=2026-11-02&to=${TUE}`, adminCookie)).body,
    );
    expect(all.items.map((d) => d.percent)).toEqual([20, 30]);
    const principal = slotDiscountListSchema.parse(
      (
        await call(
          'GET',
          `/admin/slot-discounts?from=2026-11-02&to=2026-11-02&roomId=${rooms.principal}`,
          adminCookie,
        )
      ).body,
    );
    expect(principal.items.map((d) => d.percent)).toEqual([20]);
  });
});

describe('reception (REC-141)', () => {
  it('reads the list but gets 403 on POST and DELETE', async () => {
    const reception = await createStaff(db, 'reception', NOW);
    await call(
      'POST',
      '/admin/slot-discounts',
      adminCookie,
      evening({ roomIds: [rooms.principal] }),
    );
    const [row] = await db.select().from(slotDiscounts).where(isNull(slotDiscounts.removedAt));
    const list = await call('GET', `/admin/slot-discounts?from=${TUE}&to=${TUE}`, reception.cookie);
    const post = await call('POST', '/admin/slot-discounts', reception.cookie, evening());
    const remove = await call('DELETE', `/admin/slot-discounts/${row?.id ?? ''}`, reception.cookie);
    expect(list.status).toBe(200);
    expect(slotDiscountListSchema.parse(list.body).items).toHaveLength(1);
    expect([post.status, remove.status]).toEqual([403, 403]);
    expect(post.error?.code).toBe('FORBIDDEN');
  });
});
