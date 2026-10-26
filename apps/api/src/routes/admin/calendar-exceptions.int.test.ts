import {
  availabilityDaySchema,
  closedDayCreateResultSchema,
  closedDayListSchema,
  closedDayPreviewSchema,
  holidayImportResultSchema,
  holidayListSchema,
  holidaySchema,
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
import { auditLog, closedDays, holidays, rooms } from '../../db/schema';
import { runSeed } from '../../db/seed';
import { createRegistry, type Registry } from '../../extensions/registry';
import { importNationalHolidays } from '../../modules/calendar/holiday-import';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

const NOW = new Date('2026-10-20T12:00:00Z');
const FINADOS = '2026-11-02' as LocalDate;
const FREE_DAY = '2026-11-10' as LocalDate;

let principalId = '';
let secondaryId = '';
let customerId = '';
let adminCookie = '';
let receptionCookie = '';

beforeEach(async () => {
  await runSeed(db);
  const roomRows = await db.select().from(rooms);
  principalId = roomRows.find((r) => r.slug === 'principal')?.id ?? '';
  secondaryId = roomRows.find((r) => r.slug === 'secundaria')?.id ?? '';
  customerId = (await createUser(db, { name: 'Cliente Teste' })).id;
  adminCookie = await loginAs(db, await createUser(db, { role: 'admin', totp: true }), {
    mfaVerified: true,
    now: NOW,
  });
  receptionCookie = await loginAs(db, await createUser(db, { role: 'reception', totp: true }), {
    mfaVerified: true,
    now: NOW,
  });
});

const SUMMARY = { subscribers: 3, minutes: 120, creditCents: 5000, fixedOccurrencesCancelled: 1 };

function fakePort() {
  const applied: string[][] = [];
  const registry = createRegistry({
    closedDayCompensation: {
      preview: () => Promise.resolve(SUMMARY),
      apply: (_tx, ids) => {
        applied.push(ids);
        return Promise.resolve();
      },
    },
  });
  return { applied, registry };
}

const buildApp = (registry?: Registry, fetchImpl: typeof fetch = forbiddenFetch) =>
  createApp({
    db,
    now: () => NOW,
    fetch: fetchImpl,
    env: testEnv(),
    ...(registry !== undefined && { registry }),
  });

const call = (method: string, path: string, cookie: string, body?: unknown, app = buildApp()) =>
  send(app, method, path, { cookie, ...(body !== undefined && { body }) });

const book = (
  date: LocalDate,
  from: number,
  to: number,
  extra: { roomId?: string; kind?: 'single' | 'fixed_occurrence' } = {},
) =>
  createBooking(db, {
    userId: customerId,
    roomId: extra.roomId ?? principalId,
    startsAt: localToUtc(date, from),
    endsAt: localToUtc(date, to),
    ...(extra.kind !== undefined && { kind: extra.kind }),
  });

const holidayRows = (year = 2026) =>
  call('GET', `/admin/calendar/holidays?year=${String(year)}`, adminCookie).then(
    (r) => holidayListSchema.parse(r.body).items,
  );
const actions = async () => (await db.select().from(auditLog)).map((row) => row.action);

describe('holiday listing and alerts (NUC-43)', () => {
  it('orders the year by date and flags alert only for today through today + 30 days', async () => {
    await call('POST', '/admin/calendar/holidays', adminCookie, {
      date: '2026-10-20',
      name: 'Hoje',
      scope: 'optional',
    });
    await call('POST', '/admin/calendar/holidays', adminCookie, {
      date: '2026-11-19',
      name: 'Dia 30',
      scope: 'optional',
    });

    const items = await holidayRows();

    const dates = items.map((h) => h.date);
    expect(dates).toEqual([...dates].sort());
    const alertOf = (date: string, name?: string) =>
      items.find((h) => h.date === date && (name === undefined || h.name === name))?.alert;
    expect([
      alertOf('2026-10-12'),
      alertOf('2026-10-20', 'Hoje'),
      alertOf(FINADOS),
      alertOf('2026-11-19', 'Dia 30'),
      alertOf('2026-11-20'),
    ]).toEqual([false, true, true, true, false]);
  });

  it('keeps the listing and every holiday change admin only', async () => {
    const list = await call('GET', '/admin/calendar/holidays?year=2026', receptionCookie);
    const create = await call('POST', '/admin/calendar/holidays', receptionCookie, {
      date: '2026-12-01',
      name: 'X',
      scope: 'optional',
    });

    expect([list.status, create.status]).toEqual([403, 403]);
  });
});

describe('PATCH /admin/calendar/holidays/:id (NUC-44)', () => {
  const idOf = async (date: string) => (await holidayRows()).find((h) => h.date === date)?.id ?? '';

  it('returns 409 AFFECTED_BOOKINGS when a booking exists on the holiday and keeps it open', async () => {
    const booking = await book(FINADOS, 600, 660);
    const id = await idOf(FINADOS);

    const res = await call('PATCH', `/admin/calendar/holidays/${id}`, adminCookie, {
      isClosed: true,
    });

    expect([res.status, res.error?.code]).toEqual([409, 'AFFECTED_BOOKINGS']);
    expect(
      (res.error?.details as unknown as { bookings: { code: string }[] }).bookings.map(
        (b) => b.code,
      ),
    ).toEqual([booking.code]);
    expect((await holidayRows()).find((h) => h.id === id)?.isClosed).toBe(false);
  });

  it('closes a free holiday, returns it and audits holiday.update', async () => {
    const id = await idOf('2026-11-15');

    const res = await call('PATCH', `/admin/calendar/holidays/${id}`, adminCookie, {
      isClosed: true,
    });

    expect(res.status).toBe(200);
    expect(holidaySchema.parse(res.body)).toMatchObject({ id, isClosed: true });
    const [entry] = await db.select().from(auditLog).where(eq(auditLog.action, 'holiday.update'));
    expect([
      (entry?.before as { isClosed: boolean }).isClosed,
      (entry?.after as { isClosed: boolean }).isClosed,
    ]).toEqual([false, true]);
  });
});

describe('manual holidays (NUC-45)', () => {
  it('creates a manual holiday, rejects a duplicate with 409 CONFLICT and deletes it', async () => {
    const body = { date: '2027-02-09', name: 'Carnaval', scope: 'optional' };

    const created = await call('POST', '/admin/calendar/holidays', adminCookie, body);
    const duplicate = await call('POST', '/admin/calendar/holidays', adminCookie, body);
    const removed = await call(
      'DELETE',
      `/admin/calendar/holidays/${holidaySchema.parse(created.body).id}`,
      adminCookie,
    );

    expect(created.status).toBe(201);
    expect(holidaySchema.parse(created.body)).toMatchObject({
      source: 'manual',
      scope: 'optional',
      isClosed: false,
    });
    expect([duplicate.status, duplicate.error?.code]).toEqual([409, 'CONFLICT']);
    expect(removed.status).toBe(204);
    expect(await db.select().from(holidays).where(eq(holidays.name, 'Carnaval'))).toEqual([]);
  });

  it('refuses to delete a seed holiday with 422', async () => {
    const seeded = (await holidayRows()).find((h) => h.date === FINADOS);

    const res = await call('DELETE', `/admin/calendar/holidays/${seeded?.id ?? ''}`, adminCookie);

    expect([res.status, res.error?.code]).toEqual([422, 'VALIDATION_FAILED']);
    expect(await holidayRows()).toContainEqual(expect.objectContaining({ date: FINADOS }));
  });
});

describe('POST /admin/calendar/holidays/import (NUC-46, NUC-47)', () => {
  const brasilApi = (list: unknown) => {
    const urls: string[] = [];
    const impl: typeof fetch = (input) => {
      urls.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      return Promise.resolve(Response.json(list));
    };
    return { urls, impl };
  };
  const list2027 = [
    { date: '2027-01-01', name: 'Ano Novo', type: 'national' },
    { date: '2027-02-08', name: 'Feriado Novo', type: 'national' },
    { date: '2027-03-26', name: 'Paixão de Cristo', type: 'national' },
  ];

  it('inserts missing nationals, renames an existing one and keeps its isClosed decision', async () => {
    await db.update(holidays).set({ isClosed: true }).where(eq(holidays.date, '2027-01-01'));
    const { urls, impl } = brasilApi(list2027);

    const res = await call(
      'POST',
      '/admin/calendar/holidays/import',
      adminCookie,
      { year: 2027 },
      buildApp(undefined, impl),
    );

    expect(holidayImportResultSchema.parse(res.body)).toEqual({ inserted: 1, updated: 1 });
    expect(urls).toEqual(['https://brasilapi.com.br/api/feriados/v1/2027']);
    const [renamed] = await db.select().from(holidays).where(eq(holidays.date, '2027-01-01'));
    const [added] = await db.select().from(holidays).where(eq(holidays.date, '2027-02-08'));
    expect([renamed?.name, renamed?.isClosed]).toEqual(['Ano Novo', true]);
    expect([added?.source, added?.scope, added?.isClosed]).toEqual([
      'brasilapi',
      'national',
      false,
    ]);
    expect(await actions()).toContain('holiday.import');
  });

  it('keeps the existing name when renameExisting is false (insert-only import)', async () => {
    const { impl } = brasilApi(list2027);

    const result = await importNationalHolidays(
      db,
      2027,
      { fetch: impl, now: () => NOW },
      { renameExisting: false },
    );

    expect(result).toEqual({ inserted: 1, updated: 0 });
    const [kept] = await db.select().from(holidays).where(eq(holidays.date, '2027-01-01'));
    expect(kept?.name).toBe('Confraternização Universal');
  });

  it('rejects a year other than the current or next with 422 without calling BrasilAPI', async () => {
    const { urls, impl } = brasilApi(list2027);

    const res = await call(
      'POST',
      '/admin/calendar/holidays/import',
      adminCookie,
      { year: 2030 },
      buildApp(undefined, impl),
    );

    expect([res.status, res.error?.code]).toEqual([422, 'VALIDATION_FAILED']);
    expect(urls).toEqual([]);
  });

  it.each([
    [
      'a timeout',
      () => Promise.reject(new DOMException('The operation timed out', 'TimeoutError')),
    ],
    ['a 500 response', () => Promise.resolve(new Response('boom', { status: 500 }))],
    [
      'an unparseable body',
      () => Promise.resolve(new Response('<html>oops</html>', { status: 200 })),
    ],
  ])('answers %s with 502 EXTERNAL_UNAVAILABLE and changes no row', async (_name, impl) => {
    const before = await db.select().from(holidays);

    const res = await call(
      'POST',
      '/admin/calendar/holidays/import',
      adminCookie,
      { year: 2027 },
      buildApp(undefined, impl),
    );

    expect([res.status, res.error?.code, res.error?.message]).toEqual([
      502,
      'EXTERNAL_UNAVAILABLE',
      'Não foi possível consultar os feriados agora.',
    ]);
    expect(await db.select().from(holidays)).toEqual(before);
  });
});

describe('GET /admin/calendar/closed-days/preview (NUC-48)', () => {
  it('lists affected single bookings, leaves fixed occurrences to the port and returns its numbers', async () => {
    const single = await book(FREE_DAY, 600, 660);
    await book(FREE_DAY, 720, 780, { kind: 'fixed_occurrence' });
    await book(FREE_DAY, 600, 660, { roomId: secondaryId });
    const { registry } = fakePort();
    const url = `/admin/calendar/closed-days/preview?date=${FREE_DAY}&roomIds=${principalId}`;

    const res = await call('GET', url, adminCookie, undefined, buildApp(registry));

    const parsed = closedDayPreviewSchema.parse(res.body);
    expect(parsed.affectedBookings.map((b) => b.code)).toEqual([single.code]);
    expect(parsed.compensation).toEqual(SUMMARY);
  });

  it('returns zero compensation by default, covers every room without roomIds and rejects a past date', async () => {
    await book(FREE_DAY, 600, 660);
    await book(FREE_DAY, 600, 660, { roomId: secondaryId });

    const all = await call(
      'GET',
      `/admin/calendar/closed-days/preview?date=${FREE_DAY}`,
      adminCookie,
    );
    const past = await call(
      'GET',
      '/admin/calendar/closed-days/preview?date=2026-10-19',
      adminCookie,
    );

    const parsed = closedDayPreviewSchema.parse(all.body);
    expect(parsed.affectedBookings).toHaveLength(2);
    expect(parsed.compensation).toEqual({
      subscribers: 0,
      minutes: 0,
      creditCents: 0,
      fixedOccurrencesCancelled: 0,
    });
    expect([past.status, past.error?.code]).toEqual([422, 'VALIDATION_FAILED']);
  });
});

describe('POST /admin/calendar/closed-days (NUC-49)', () => {
  it('closes the whole clinic with one row, calls the port apply and audits closed_day.create', async () => {
    const { applied, registry } = fakePort();

    const res = await call(
      'POST',
      '/admin/calendar/closed-days',
      adminCookie,
      { date: FREE_DAY, roomIds: null, reason: 'Obras' },
      buildApp(registry),
    );

    expect(res.status).toBe(201);
    const parsed = closedDayCreateResultSchema.parse(res.body);
    expect(parsed.items.map((i) => [i.date, i.roomId, i.roomName, i.reason])).toEqual([
      [FREE_DAY, null, null, 'Obras'],
    ]);
    expect(parsed.compensation).toEqual(SUMMARY);
    expect(applied).toEqual([parsed.items.map((i) => i.id)]);
    expect(await actions()).toEqual(['closed_day.create']);
  });

  it('closes selected rooms with one row per room', async () => {
    const res = await call('POST', '/admin/calendar/closed-days', adminCookie, {
      date: FREE_DAY,
      roomIds: [principalId, secondaryId],
    });

    const parsed = closedDayCreateResultSchema.parse(res.body);
    expect(parsed.items.map((i) => i.roomName).sort()).toEqual([
      'Sala Principal',
      'Sala Secundária',
    ]);
    expect(await db.select().from(closedDays)).toHaveLength(2);
  });

  it('returns 409 AFFECTED_BOOKINGS for a booked date and 422 for a past date, creating nothing', async () => {
    await book(FREE_DAY, 600, 660);

    const affected = await call('POST', '/admin/calendar/closed-days', adminCookie, {
      date: FREE_DAY,
      roomIds: null,
    });
    const past = await call('POST', '/admin/calendar/closed-days', adminCookie, {
      date: '2026-10-19',
      roomIds: null,
    });

    expect([affected.status, affected.error?.code]).toEqual([409, 'AFFECTED_BOOKINGS']);
    expect([past.status, past.error?.code]).toEqual([422, 'VALIDATION_FAILED']);
    expect(await db.select().from(closedDays)).toEqual([]);
  });

  it('closes a date that only has a fixed occurrence, which stays with the port', async () => {
    await book(FREE_DAY, 600, 660, { kind: 'fixed_occurrence' });

    const res = await call('POST', '/admin/calendar/closed-days', adminCookie, {
      date: FREE_DAY,
      roomIds: null,
    });

    expect(res.status).toBe(201);
  });
});

describe('DELETE /admin/calendar/closed-days/:id (NUC-50)', () => {
  const availability = async () =>
    availabilityDaySchema.parse(
      (await send(buildApp(), 'GET', `/public/rooms/principal/availability?date=${FREE_DAY}`)).body,
    );

  it('reopens the date: availability shows cells again and closed_day.delete is audited', async () => {
    const created = await call('POST', '/admin/calendar/closed-days', adminCookie, {
      date: FREE_DAY,
      roomIds: null,
    });
    const id = closedDayCreateResultSchema.parse(created.body).items[0]?.id ?? '';
    const closed = await availability();

    const res = await call('DELETE', `/admin/calendar/closed-days/${id}`, adminCookie);

    expect(res.status).toBe(204);
    expect([closed.closed, closed.cells]).toEqual([true, []]);
    const reopened = await availability();
    expect([reopened.closed, reopened.cells.length > 0]).toEqual([false, true]);
    expect(await actions()).toEqual(['closed_day.create', 'closed_day.delete']);
  });

  it('answers 404 for an unknown id and lets reception list closed days but not create them', async () => {
    const missing = await call(
      'DELETE',
      '/admin/calendar/closed-days/3f2b8c6e-1a4d-4e5f-8a9b-0c1d2e3f4a5b',
      adminCookie,
    );
    const list = await call(
      'GET',
      `/admin/calendar/closed-days?from=${FREE_DAY}&to=2026-11-30`,
      receptionCookie,
    );
    const create = await call('POST', '/admin/calendar/closed-days', receptionCookie, {
      date: FREE_DAY,
      roomIds: null,
    });

    expect([missing.status, missing.error?.code]).toEqual([404, 'NOT_FOUND']);
    expect(closedDayListSchema.parse(list.body)).toEqual({ items: [] });
    expect([create.status, create.error?.code]).toEqual([403, 'FORBIDDEN']);
  });
});
