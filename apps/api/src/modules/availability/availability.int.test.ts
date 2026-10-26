import {
  adminAvailabilityDaySchema,
  availabilityDaySchema,
  availabilityMonthSchema,
  localToUtc,
  type LocalDate,
} from '@bravo/core';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createBooking, createCategory, createUser } from '../../../test/factories';
import { forbiddenFetch, send, testEnv } from '../../../test/http';
import { requireTestDatabaseUrl } from '../../../test/require-test-db';
import { createApp } from '../../app';
import { createDb } from '../../db/client';
import { blocks, closedDays, rateLimitBuckets, roomOccupancy, rooms } from '../../db/schema';
import { runSeed } from '../../db/seed';
import { createRegistry } from '../../extensions/registry';
import { rateLimitKey } from '../../middleware/rate-limit';
import { getAdminDay } from './availability.service';
import { getReferenceCategory, loadDayContexts } from '../calendar/calendar.repo';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

const NOW = new Date('2026-10-20T12:00:00Z');
const TUESDAY = '2026-10-27' as LocalDate;
const WEDNESDAY = '2026-10-28' as LocalDate;

const at = (date: LocalDate, hhmm: string): Date => {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  return localToUtc(date, h * 60 + m);
};

function buildApp(registry = createRegistry()) {
  return createApp({ db, now: () => NOW, fetch: forbiddenFetch, env: testEnv(), registry });
}

let roomId = '';
let userId = '';

beforeEach(async () => {
  await runSeed(db);
  const [room] = await db.select().from(rooms).where(eq(rooms.slug, 'principal'));
  roomId = room?.id ?? '';
  userId = (await createUser(db, { name: 'Fulana Secreta' })).id;
});

const book = (date: LocalDate, from: string, to: string, extra: Record<string, unknown> = {}) =>
  createBooking(db, {
    userId,
    roomId,
    startsAt: at(date, from),
    endsAt: at(date, to),
    ...extra,
  });

async function blockSlot(date: LocalDate, from: string, to: string, tag: string) {
  const [block] = await db
    .insert(blocks)
    .values({ roomId, tag, startsAt: at(date, from), endsAt: at(date, to) })
    .returning();
  if (block === undefined) throw new Error('block insert failed');
  await db.insert(roomOccupancy).values({
    roomId,
    period: `[${block.startsAt.toISOString()},${block.endsAt.toISOString()})`,
    kind: 'block',
    refId: block.id,
  });
}

const day = (date: string, slug = 'principal', app = buildApp()) =>
  send(app, 'GET', `/public/rooms/${slug}/availability?date=${date}`);

describe('GET /public/rooms/:slug/availability (NUC-77, NUC-78, NUC-82)', () => {
  it('returns CL-9 cells 11:30 and 12:00 unavailable and 14:30 available with only public fields', async () => {
    await book(TUESDAY, '09:00', '11:00');
    await book(TUESDAY, '12:30', '14:00');

    const res = await day(TUESDAY);

    expect(res.status).toBe(200);
    const parsed = availabilityDaySchema.parse(res.body);
    const cell = (minute: number) => parsed.cells.find((c) => c.startMinute === minute);
    expect(cell(690)).toEqual({ startMinute: 690, available: false, maxEndMinute: null });
    expect(cell(720)).toEqual({ startMinute: 720, available: false, maxEndMinute: null });
    expect(cell(870)).toEqual({ startMinute: 870, available: true, maxEndMinute: 1440 });
    expect(parsed.window).toEqual({ openMinute: 420, closeMinute: 1440 });
    expect(parsed.slotMinutes).toBe(30);
    expect(parsed.minBookingMinutes).toBe(60);
  });

  it('returns CL-1 and CL-10 shapes without admin states, customer names, tags or cleanup periods', async () => {
    await book(WEDNESDAY, '09:00', '11:00');
    await blockSlot(WEDNESDAY, '15:00', '16:00', 'Limpeza profunda');

    const res = await day(WEDNESDAY);

    const parsed = availabilityDaySchema.parse(res.body);
    const cell = (minute: number) => parsed.cells.find((c) => c.startMinute === minute);
    expect(cell(660)).toEqual({ startMinute: 660, available: false, maxEndMinute: null });
    expect(cell(690)?.maxEndMinute).toBe(870);
    expect(cell(840)).toEqual({ startMinute: 840, available: true, maxEndMinute: null });
    expect(cell(810)?.maxEndMinute).toBe(870);
    const text = JSON.stringify(res.body);
    for (const secret of ['Fulana', 'Limpeza profunda', 'adminState', 'cleanup', 'BRV-']) {
      expect(text).not.toContain(secret);
    }
  });

  it('flags the holiday 2026-11-02 with its name and the holiday hours', async () => {
    const res = await day('2026-11-02');

    const parsed = availabilityDaySchema.parse(res.body);
    expect([parsed.isHoliday, parsed.holidayName, parsed.closed]).toEqual([true, 'Finados', false]);
    expect(parsed.window).toEqual({ openMinute: 540, closeMinute: 1440 });
  });

  it('returns closed: true, no window and no cells on a closed day', async () => {
    await db.insert(closedDays).values({ date: WEDNESDAY, roomId: null, reason: 'Obras' });

    const res = await day(WEDNESDAY);

    const parsed = availabilityDaySchema.parse(res.body);
    expect([parsed.closed, parsed.window, parsed.cells, parsed.blockOptions]).toEqual([
      true,
      null,
      [],
      [],
    ]);
  });

  it('treats an expired hold as free and a live hold as occupied (NUC-80)', async () => {
    await book(TUESDAY, '09:00', '11:00', {
      status: 'awaiting_payment',
      holdExpiresAt: new Date(NOW.getTime() - 60_000),
    });
    await book(WEDNESDAY, '09:00', '11:00', {
      status: 'awaiting_payment',
      holdExpiresAt: new Date(NOW.getTime() + 10 * 60_000),
    });

    const stale = availabilityDaySchema.parse((await day(TUESDAY)).body);
    const live = availabilityDaySchema.parse((await day(WEDNESDAY)).body);

    expect(stale.cells.find((c) => c.startMinute === 540)?.available).toBe(true);
    expect(live.cells.find((c) => c.startMinute === 540)?.available).toBe(false);
  });

  it('lists a block category as an option that is unavailable once partially occupied (NUC-83)', async () => {
    const morning = await createCategory(db, {
      type: 'block',
      name: 'Manhã',
      startMinute: 420,
      endMinute: 720,
      fixedPriceCents: 28000,
    });
    await createCategory(db, {
      type: 'block',
      name: 'Bloco interno',
      visibility: 'admin_only',
      fixedPriceCents: 1000,
    });
    await book(WEDNESDAY, '10:00', '11:00');

    const free = availabilityDaySchema.parse((await day(TUESDAY)).body);
    const partial = availabilityDaySchema.parse((await day(WEDNESDAY)).body);

    const option = {
      categoryId: morning.id,
      name: 'Manhã',
      startMinute: 420,
      endMinute: 720,
      priceCents: 28000,
    };
    expect(free.blockOptions).toEqual([{ ...option, available: true }]);
    expect(partial.blockOptions).toEqual([{ ...option, available: false }]);
  });

  it('returns 422 VALIDATION_FAILED for a malformed date and 404 for an unknown room', async () => {
    const malformed = await day('2026-13-45');
    const missing = await day(TUESDAY, 'sala-inexistente');

    expect([malformed.status, malformed.error?.code]).toEqual([422, 'VALIDATION_FAILED']);
    expect([missing.status, missing.error?.code]).toEqual([404, 'NOT_FOUND']);
  });

  it('adds the discountPercent of a registered availability decorator to every cell (NUC-202)', async () => {
    const registry = createRegistry({
      availabilityDecorators: [
        {
          decorate: (_db, { cells }) =>
            Promise.resolve(cells.map((cell) => ({ ...cell, discountPercent: 10 }))),
        },
      ],
    });

    const res = await day(TUESDAY, 'principal', buildApp(registry));

    const parsed = availabilityDaySchema.parse(res.body);
    expect(parsed.cells.length).toBeGreaterThan(0);
    expect(parsed.cells.every((c) => c.discountPercent === 10)).toBe(true);
  });
});

describe('GET /public/rooms/:slug/availability/month (NUC-79, NUC-82)', () => {
  const month = (value: string) =>
    send(buildApp(), 'GET', `/public/rooms/principal/availability/month?month=${value}`);

  it('reports past, available, full, closed and the holiday flags for October and November', async () => {
    await blockSlot('2026-10-29', '07:00', '24:00', 'Reforma');
    await db.insert(closedDays).values({ date: '2026-10-30', roomId: null });

    const october = availabilityMonthSchema.parse((await month('2026-10')).body);
    const november = availabilityMonthSchema.parse((await month('2026-11')).body);

    const status = (date: string) => october.days.find((d) => d.date === date)?.status;
    expect(october.days).toHaveLength(31);
    expect([
      status('2026-10-19'),
      status('2026-10-27'),
      status('2026-10-29'),
      status('2026-10-30'),
    ]).toEqual(['past', 'available', 'full', 'closed']);
    const finados = november.days.find((d) => d.date === '2026-11-02');
    expect([finados?.isHoliday, finados?.holidayName, finados?.status]).toEqual([
      true,
      'Finados',
      'available',
    ]);
  });

  it('marks days after today + 90 as out_of_range and the last allowed day as available', async () => {
    const january = availabilityMonthSchema.parse((await month('2027-01')).body);

    const status = (date: string) => january.days.find((d) => d.date === date)?.status;
    expect([status('2027-01-18'), status('2027-01-19')]).toEqual(['available', 'out_of_range']);
  });

  it('returns 422 for a malformed month', async () => {
    const res = await month('2026-1');

    expect([res.status, res.error?.code]).toEqual([422, 'VALIDATION_FAILED']);
  });
});

describe('public availability rate limit (NUC-81)', () => {
  it('answers the 121st request of a minute from one IP with 429 and Retry-After', async () => {
    const headers = { 'X-Forwarded-For': '203.0.113.9' };
    await db.insert(rateLimitBuckets).values({
      key: rateLimitKey('public-calendar', '203.0.113.9'),
      windowStart: new Date('2026-10-20T12:00:00Z'),
      count: 119,
    });
    const app = buildApp();
    const url = `/public/rooms/principal/availability?date=${TUESDAY}`;

    const hundredTwentieth = await send(app, 'GET', url, { headers });
    const hundredTwentyFirst = await send(app, 'GET', url, { headers });
    const otherIp = await send(app, 'GET', url, { headers: { 'X-Forwarded-For': '203.0.113.10' } });

    expect(hundredTwentieth.status).toBe(200);
    expect([hundredTwentyFirst.status, hundredTwentyFirst.error?.code]).toEqual([
      429,
      'TOO_MANY_ATTEMPTS',
    ]);
    expect(hundredTwentyFirst.headers.get('Retry-After')).toBe('60');
    expect(otherIp.status).toBe(200);
  });
});

describe('calendar read helpers (NUC-14, design "Availability")', () => {
  it('loadDayContexts returns window, occupied intervals and the closed flag per date', async () => {
    await book(TUESDAY, '09:00', '11:00');
    await db.insert(closedDays).values({ date: WEDNESDAY, roomId: null });

    const contexts = await loadDayContexts(db, { roomId, dates: [WEDNESDAY, TUESDAY], now: NOW });

    const tuesday = contexts.get(TUESDAY);
    const wednesday = contexts.get(WEDNESDAY);
    expect(tuesday?.window).toEqual({ openMinute: 420, closeMinute: 1440, isHoliday: false });
    expect(tuesday?.closed).toBe(false);
    expect(
      tuesday?.occupied.map((o) => [
        o.start.toISOString(),
        o.end.toISOString(),
        o.occupiedUntil.toISOString(),
      ]),
    ).toEqual([
      ['2026-10-27T12:00:00.000Z', '2026-10-27T14:00:00.000Z', '2026-10-27T14:30:00.000Z'],
    ]);
    expect([wednesday?.window, wednesday?.closed, wednesday?.occupied]).toEqual([null, true, []]);
  });

  it('getReferenceCategory returns the "1 hora" category', async () => {
    const reference = await getReferenceCategory(db);

    expect([reference?.name, reference?.isReference, reference?.weekdayRateCents]).toEqual([
      '1 hora',
      true,
      9700,
    ]);
  });

  it('getAdminDay marks booking, cleanup and leftover cells of CL-9 with their admin states', async () => {
    await book(TUESDAY, '09:00', '11:00');
    await book(TUESDAY, '12:30', '14:00');

    const admin = adminAvailabilityDaySchema.parse(await getAdminDay(db, roomId, TUESDAY, NOW));

    const state = (minute: number) => admin.cells.find((c) => c.startMinute === minute)?.adminState;
    expect([state(540), state(660), state(690), state(720), state(870)]).toEqual([
      'booking',
      'cleanup',
      'leftover',
      'leftover',
      'free',
    ]);
  });
});
