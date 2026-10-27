import { randomUUID } from 'node:crypto';
import {
  adminAvailabilityDaySchema,
  adminBookingDetailSchema,
  adminBookingListSchema,
  calendarEventsSchema,
  localToUtc,
  policySnapshot,
  settingDefaults,
  type LocalDate,
} from '@bravo/core';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStaff, createTenant, seededRoom } from '../../../test/booking-helpers';
import { createBooking as insertBooking, createCategory } from '../../../test/factories';
import { forbiddenFetch, send, testEnv } from '../../../test/http';
import { requireTestDatabaseUrl } from '../../../test/require-test-db';
import { createApp } from '../../app';
import { createDb } from '../../db/client';
import { blocks, bookingSegments, bookings, closedDays, users } from '../../db/schema';
import { runSeed } from '../../db/seed';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

const NOW = new Date('2026-10-20T12:00:00.000Z');
const HOUR = 3_600_000;
const TUE = '2026-10-27' as LocalDate;

let roomId = '';
let staffCookie = '';

beforeEach(async () => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  await runSeed(db);
  roomId = (await seededRoom(db)).id;
  staffCookie = (await createStaff(db, 'reception', NOW)).cookie;
});

const get = async (path: string) =>
  send(createApp({ db, now: () => NOW, fetch: forbiddenFetch, env: testEnv() }), 'GET', path, {
    cookie: staffCookie,
  });

/** A tenant with a fixed name and e-mail, so searches have something to match. */
async function customer(name: string, email: string) {
  const { user } = await createTenant(db, { name, email, now: NOW });
  return user;
}

describe('GET /admin/calendar/events (NUC-157)', () => {
  it('returns the week with first and full names, cleanup end, tags, closed days and holidays', async () => {
    const ana = await customer('Ana Maria Souza', 'ana@exemplo.com');
    const booked = await insertBooking(db, {
      userId: ana.id,
      roomId,
      startsAt: localToUtc(TUE, 840),
      endsAt: localToUtc(TUE, 900),
      totalCents: 9700,
      paidCents: 4851,
    });
    await insertBooking(db, {
      userId: ana.id,
      roomId,
      startsAt: localToUtc(TUE, 1000),
      endsAt: localToUtc(TUE, 1060),
      status: 'cancelled_by_tenant',
    });
    await insertBooking(db, {
      userId: ana.id,
      roomId,
      startsAt: localToUtc(TUE, 1100),
      endsAt: localToUtc(TUE, 1160),
      status: 'awaiting_payment',
      paidCents: 0,
      holdExpiresAt: new Date(NOW.getTime() - HOUR),
    });
    await db.insert(blocks).values({
      roomId,
      tag: 'Reunião da equipe',
      startsAt: localToUtc(TUE, 540),
      endsAt: localToUtc(TUE, 600),
    });
    await db.insert(closedDays).values({ date: '2026-10-30', roomId: null, reason: 'Obra' });

    const res = await get('/admin/calendar/events?from=2026-10-26&to=2026-11-02');

    expect(res.status).toBe(200);
    const feed = calendarEventsSchema.parse(res.body);
    expect(feed.bookings).toHaveLength(1);
    expect(feed.bookings[0]).toMatchObject({
      id: booked.id,
      firstName: 'Ana',
      fullName: 'Ana Maria Souza',
      roomName: 'Sala Principal',
      status: 'confirmed',
      statusLabel: 'Confirmada',
      paidCents: 4851,
      totalCents: 9700,
      packageMinutes: 0,
      categoryNames: ['Hora teste'],
      checkedInAt: null,
    });
    expect(feed.bookings[0]?.cleanupUntil).toBe(localToUtc(TUE, 930).toISOString());
    expect(feed.blocks.map((b) => b.tag)).toEqual(['Reunião da equipe']);
    expect(feed.closedDays.map((c) => [c.date, c.reason])).toEqual([['2026-10-30', 'Obra']]);
    expect(feed.holidays.map((h) => [h.date, h.name])).toContainEqual(['2026-11-02', 'Finados']);
  });

  it('keeps a renewal hold without an expiry and drops an expired one (REC-92, NUC-80)', async () => {
    const ana = await customer('Ana Souza', 'ana@exemplo.com');
    const held = await insertBooking(db, {
      userId: ana.id,
      roomId,
      startsAt: localToUtc(TUE, 420),
      endsAt: localToUtc(TUE, 570),
      status: 'held_for_renewal',
      paidCents: 0,
      holdExpiresAt: null,
    });
    await insertBooking(db, {
      userId: ana.id,
      roomId,
      startsAt: localToUtc(TUE, 840),
      endsAt: localToUtc(TUE, 900),
      status: 'held_for_renewal',
      paidCents: 0,
      holdExpiresAt: new Date(NOW.getTime() - HOUR),
    });

    const res = await get('/admin/calendar/events?from=2026-10-26&to=2026-11-01');

    expect(res.status).toBe(200);
    const feed = calendarEventsSchema.parse(res.body);
    expect(feed.bookings.map((b) => [b.id, b.status, b.statusLabel])).toEqual([
      [held.id, 'held_for_renewal', 'Pré-reservada (renovação)'],
    ]);
  });

  it('answers 422 for a range of 43 days', async () => {
    const res = await get('/admin/calendar/events?from=2026-10-01&to=2026-11-13');

    expect(res.status).toBe(422);
    expect(res.error?.code).toBe('VALIDATION_FAILED');
  });

  it('narrows the feed by room, status and category', async () => {
    const ana = await customer('Ana Souza', 'ana@exemplo.com');
    const second = await seededRoom(db, 'secundaria');
    const category = await createCategory(db, { name: 'Hora especial' });
    const inMain = await insertBooking(db, {
      userId: ana.id,
      roomId,
      startsAt: localToUtc(TUE, 840),
      endsAt: localToUtc(TUE, 900),
    });
    const inSecond = await insertBooking(db, {
      userId: ana.id,
      roomId: second.id,
      startsAt: localToUtc(TUE, 840),
      endsAt: localToUtc(TUE, 900),
      status: 'paid',
    });
    await db
      .update(bookingSegments)
      .set({ categoryId: category.id })
      .where(eq(bookingSegments.bookingId, inSecond.id));
    const cancelled = await insertBooking(db, {
      userId: ana.id,
      roomId,
      startsAt: localToUtc(TUE, 1000),
      endsAt: localToUtc(TUE, 1060),
      status: 'cancelled_by_clinic',
    });
    const range = 'from=2026-10-26&to=2026-11-01';
    const idsOf = async (query: string) =>
      calendarEventsSchema
        .parse((await get(`/admin/calendar/events?${range}${query}`)).body)
        .bookings.map((b) => b.id)
        .sort();

    expect(await idsOf('')).toEqual([inMain.id, inSecond.id].sort());
    expect(await idsOf(`&roomId=${roomId}`)).toEqual([inMain.id]);
    expect(await idsOf('&status=paid')).toEqual([inSecond.id]);
    expect(await idsOf('&status=cancelled_by_clinic')).toEqual([cancelled.id]);
    expect(await idsOf(`&categoryId=${category.id}`)).toEqual([inSecond.id]);
  });
});

describe('GET /admin/rooms/:roomId/availability', () => {
  it('returns the day grid with admin states and rejects a malformed date', async () => {
    const ana = await customer('Ana Souza', 'ana@exemplo.com');
    await insertBooking(db, {
      userId: ana.id,
      roomId,
      startsAt: localToUtc(TUE, 540),
      endsAt: localToUtc(TUE, 600),
    });

    const res = await get(`/admin/rooms/${roomId}/availability?date=${TUE}`);
    const bad = await get(`/admin/rooms/${roomId}/availability?date=amanha`);

    expect(res.status).toBe(200);
    const day = adminAvailabilityDaySchema.parse(res.body);
    expect(day.cells.find((c) => c.startMinute === 540)?.adminState).toBe('booking');
    expect(day.cells.find((c) => c.startMinute === 600)?.adminState).toBe('cleanup');
    expect(bad.status).toBe(422);
  });
});

describe('GET /admin/bookings (NUC-177)', () => {
  it('finds bookings by code, customer name and e-mail, ignoring case, newest start first', async () => {
    const ana = await customer('Ana Souza', 'ana.souza@exemplo.com');
    const bruno = await customer('Bruno Lima', 'bruno@exemplo.com');
    const early = await insertBooking(db, {
      userId: ana.id,
      roomId,
      startsAt: localToUtc(TUE, 540),
      endsAt: localToUtc(TUE, 600),
    });
    const late = await insertBooking(db, {
      userId: ana.id,
      roomId,
      startsAt: localToUtc(TUE, 840),
      endsAt: localToUtc(TUE, 900),
    });
    const other = await insertBooking(db, {
      userId: bruno.id,
      roomId,
      startsAt: localToUtc(TUE, 1100),
      endsAt: localToUtc(TUE, 1160),
    });
    const ids = async (q: string) =>
      adminBookingListSchema
        .parse((await get(`/admin/bookings?q=${encodeURIComponent(q)}`)).body)
        .items.map((b) => b.id);

    expect(await ids(other.code.toLowerCase())).toEqual([other.id]);
    expect(await ids('ANA SOUZA')).toEqual([late.id, early.id]);
    expect(await ids('BRUNO@EXEMPLO')).toEqual([other.id]);
    expect(await ids('')).toEqual([other.id, late.id, early.id]);
    const first = adminBookingListSchema.parse((await get('/admin/bookings?q=ana')).body).items[0];
    expect(first).toMatchObject({
      customerName: 'Ana Souza',
      customerEmail: 'ana.souza@exemplo.com',
      source: 'web',
      statusLabel: 'Confirmada',
    });
  });

  it('pages at 50 rows with nextCursor and filters by status and room', async () => {
    const ana = await customer('Ana Souza', 'ana@exemplo.com');
    const second = await seededRoom(db, 'secundaria');
    await db.insert(bookings).values(
      Array.from({ length: 51 }, (_, i) => ({
        code: `BRV-LIST${String(i).padStart(2, '0')}`,
        userId: ana.id,
        roomId,
        kind: 'single',
        status: 'confirmed',
        source: 'admin',
        cleanupMinutes: 30,
        durationMinutes: 60,
        paymentMode: 'deposit_balance',
        policySnapshot: policySnapshot(settingDefaults()),
        icsUid: `${randomUUID()}@bravoclinic.test`,
        startsAt: new Date(NOW.getTime() + (30 + i) * HOUR),
        endsAt: new Date(NOW.getTime() + (31 + i) * HOUR),
      })),
    );
    const done = await insertBooking(db, {
      userId: ana.id,
      roomId: second.id,
      startsAt: localToUtc(TUE, 840),
      endsAt: localToUtc(TUE, 900),
      status: 'completed',
    });

    const first = adminBookingListSchema.parse((await get('/admin/bookings')).body);
    const rest = adminBookingListSchema.parse(
      (await get(`/admin/bookings?cursor=${first.nextCursor ?? ''}`)).body,
    );
    const completed = adminBookingListSchema.parse(
      (await get('/admin/bookings?status=completed')).body,
    );
    const inSecond = adminBookingListSchema.parse(
      (await get(`/admin/bookings?roomId=${second.id}`)).body,
    );

    expect(first.items).toHaveLength(50);
    expect(first.nextCursor).not.toBeNull();
    expect(rest.items).toHaveLength(2);
    expect(rest.nextCursor).toBeNull();
    expect(new Set([...first.items, ...rest.items].map((b) => b.id)).size).toBe(52);
    expect(completed.items.map((b) => b.id)).toEqual([done.id]);
    expect(inSecond.items.map((b) => b.id)).toEqual([done.id]);
  });

  it('returns the detail with the customer, 404 for an unknown id', async () => {
    const ana = await customer('Ana Souza', 'ana@exemplo.com');
    await db.update(users).set({ phone: '+5547999991234' }).where(eq(users.id, ana.id));
    const row = await insertBooking(db, {
      userId: ana.id,
      roomId,
      startsAt: localToUtc(TUE, 840),
      endsAt: localToUtc(TUE, 900),
    });

    const res = await get(`/admin/bookings/${row.id}`);
    const missing = await get(`/admin/bookings/${randomUUID()}`);

    expect(adminBookingDetailSchema.parse(res.body).customer).toEqual({
      id: ana.id,
      name: 'Ana Souza',
      email: 'ana@exemplo.com',
      phone: '+5547999991234',
    });
    expect(missing.status).toBe(404);
  });
});

describe('GET /admin/bookings/export.csv (NUC-178)', () => {
  const csvOf = async (path = '/admin/bookings/export.csv') => {
    const response = await createApp({
      db,
      now: () => NOW,
      fetch: forbiddenFetch,
      env: testEnv(),
    }).request(path, { headers: { Cookie: staffCookie } });
    // `Response.text()` drops a leading BOM, so the bytes are read and decoded keeping it.
    const bytes = new Uint8Array(await response.arrayBuffer());
    return { response, bytes, text: new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes) };
  };

  it('writes a BOM, the exact header, ; separators, São Paulo dates and pt-BR amounts', async () => {
    const ana = await customer('Ana Souza', 'ana@exemplo.com');
    const row = await insertBooking(db, {
      userId: ana.id,
      roomId,
      startsAt: localToUtc(TUE, 1050),
      endsAt: localToUtc(TUE, 1200),
      totalCents: 21900,
      paidCents: 10950,
      depositCents: 10950,
    });

    const { response, bytes, text } = await csvOf();

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(text.slice(1).split('\r\n')).toEqual([
      'Código;Cliente;E-mail;Sala;Início;Fim;Status;Total (R$);Pago (R$);Saldo (R$);Origem',
      `${row.code};Ana Souza;ana@exemplo.com;Sala Principal;27/10/2026 17:30;27/10/2026 20:00;Confirmada;219,00;109,50;109,50;Site`,
      '',
    ]);
  });

  it('quotes cells with separators and defuses formulas in names', async () => {
    const odd = await customer('Silva; Filho', 'silva@exemplo.com');
    const formula = await customer('=SOMA(A1)', 'formula@exemplo.com');
    await insertBooking(db, {
      userId: odd.id,
      roomId,
      startsAt: localToUtc(TUE, 540),
      endsAt: localToUtc(TUE, 600),
    });
    await insertBooking(db, {
      userId: formula.id,
      roomId,
      startsAt: localToUtc(TUE, 840),
      endsAt: localToUtc(TUE, 900),
    });

    const { text } = await csvOf();

    expect(text).toContain(';"Silva; Filho";');
    expect(text).toContain(";'=SOMA(A1);");
  });

  it('answers 422 with the message when more than 5 000 rows match', async () => {
    const ana = await customer('Ana Souza', 'ana@exemplo.com');
    const base = {
      userId: ana.id,
      roomId,
      kind: 'single',
      status: 'completed',
      source: 'web',
      cleanupMinutes: 30,
      durationMinutes: 60,
      paymentMode: 'deposit_balance',
      policySnapshot: policySnapshot(settingDefaults()),
      startsAt: localToUtc(TUE, 540),
      endsAt: localToUtc(TUE, 600),
    };
    for (let chunk = 0; chunk < 6; chunk++) {
      const size = chunk === 5 ? 1 : 1000;
      await db.insert(bookings).values(
        Array.from({ length: size }, (_, i) => ({
          ...base,
          code: `BRV-C${String(chunk)}${String(i).padStart(4, '0')}`,
          icsUid: `${randomUUID()}@bravoclinic.test`,
        })),
      );
    }

    const res = await get('/admin/bookings/export.csv');

    expect(res.status).toBe(422);
    expect(res.error?.message).toBe('Refine os filtros (máximo de 5.000 linhas).');
  });
});
