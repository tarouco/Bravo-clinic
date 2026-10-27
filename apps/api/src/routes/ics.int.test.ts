import { addDays, localToUtc, type LocalDate } from '@bravo/core';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStaff, createTenant, seededRoom } from '../../test/booking-helpers';
import { createBooking as insertBooking } from '../../test/factories';
import { forbiddenFetch, send, testEnv } from '../../test/http';
import { requireTestDatabaseUrl } from '../../test/require-test-db';
import { createApp } from '../app';
import { createDb } from '../db/client';
import { auditLog, blocks, bookings, icsFeedTokens, rateLimitBuckets } from '../db/schema';
import { runSeed } from '../db/seed';
import { sha256Hex } from '../lib/crypto';
import { feedRateLimitKey } from '../modules/ics/ics-feed.service';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

// Local noon of 2027-03-10 (a Wednesday), far from the wall clock.
const NOW = new Date('2027-03-10T15:00:00.000Z');
const TODAY = '2027-03-10' as LocalDate;
const at = (date: LocalDate, minute: number) => localToUtc(date, minute);
const URL_PATTERN = /^http:\/\/localhost:5173\/api\/ics\/([A-Za-z0-9_-]{43})\.ics$/;

let principal = { id: '', name: '' };
let secundaria = { id: '', name: '' };

beforeEach(async () => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  await runSeed(db);
  principal = await seededRoom(db, 'principal');
  secundaria = await seededRoom(db, 'secundaria');
});

const app = () => createApp({ db, now: () => NOW, fetch: forbiddenFetch, env: testEnv() });
const call = (method: string, path: string, cookie?: string, body?: unknown) =>
  send(app(), method, path, {
    ...(cookie !== undefined && { cookie }),
    ...(body !== undefined && { body }),
  });

/** Fetches a feed URL the way a calendar client does (no cookie, no origin). */
async function fetchFeed(url: string) {
  const response = await app().request(url.replace('http://localhost:5173/api', ''));
  const text = await response.text();
  return { status: response.status, headers: response.headers, text };
}

interface ParsedEvent {
  uid: string;
  summary: string;
  dtstart: string;
  sequence: number;
  status: string;
  raw: string;
}

/** Unfolds the calendar and splits its VEVENTs into their main properties. */
function events(calendar: string): ParsedEvent[] {
  const unfolded = calendar.replace(/\r\n /g, '');
  return unfolded
    .split('BEGIN:VEVENT')
    .slice(1)
    .map((block) => {
      const prop = (name: string) =>
        new RegExp(`\\r\\n${name}:([^\\r]*)`).exec(`\r\n${block}`)?.[1] ?? '';
      return {
        uid: prop('UID'),
        summary: prop('SUMMARY'),
        dtstart: prop('DTSTART'),
        sequence: Number(prop('SEQUENCE')),
        status: prop('STATUS'),
        raw: block,
      };
    });
}

const icsUtc = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace('.000', '');

const booking = (
  userId: string,
  roomId: string,
  startsAt: Date,
  overrides: Partial<Parameters<typeof insertBooking>[1]> = {},
) =>
  insertBooking(db, {
    userId,
    roomId,
    startsAt,
    endsAt: new Date(startsAt.getTime() + 3_600_000),
    occupancy: false,
    totalCents: 12345,
    ...overrides,
  });

type BookingRow = Awaited<ReturnType<typeof booking>>;

const audits = (action: string) =>
  db
    .select()
    .from(auditLog)
    .where(eq(auditLog.action, action))
    .then((rows) => rows);

async function issueClinicFeed(
  cookie: string,
  body: Record<string, unknown> = { scope: 'clinic' },
) {
  const res = await call('POST', '/admin/integrations/calendar/feeds', cookie, body);
  expect(res.status).toBe(201);
  return res.body as { url: string; prefix: string };
}

describe('admin clinic and room feeds (GES-42, GES-43)', () => {
  it('issues a feed URL once and stores only the hash and the 6-char prefix, audited', async () => {
    const admin = await createStaff(db, 'admin', NOW);

    const issued = await issueClinicFeed(admin.cookie);

    const token = URL_PATTERN.exec(issued.url)?.[1] ?? '';
    expect(token).toHaveLength(43);
    expect(issued.prefix).toBe(token.slice(0, 6));
    const rows = await db.select().from(icsFeedTokens);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      scope: 'clinic',
      tokenHash: sha256Hex(token),
      tokenPrefix: token.slice(0, 6),
      roomId: null,
      userId: null,
      revokedAt: null,
      createdBy: admin.user.id,
    });
    expect(JSON.stringify(rows)).not.toContain(token);
    const [entry] = await audits('ics_feed.issue');
    expect(entry).toMatchObject({
      entityType: 'ics_feed',
      entityId: rows[0]?.id,
      actorUserId: admin.user.id,
      origin: 'admin',
      after: { scope: 'clinic', roomId: null, userId: null, prefix: token.slice(0, 6) },
    });
    expect(JSON.stringify(entry)).not.toContain(token);

    const listed = await call('GET', '/admin/integrations/calendar', admin.cookie);
    expect(listed.status).toBe(200);
    expect(listed.body).toEqual({
      feeds: [
        {
          id: rows[0]?.id,
          scope: 'clinic',
          roomId: null,
          roomName: null,
          prefix: token.slice(0, 6),
          createdAt: NOW.toISOString(),
        },
      ],
      rooms: [
        { id: principal.id, name: 'Sala Principal' },
        { id: secundaria.id, name: 'Sala Secundária' },
        expect.objectContaining({ name: 'Sala Terceira' }),
      ],
    });
  });

  it('regenerating a clinic feed revokes the previous one: its URL answers 404', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const first = await issueClinicFeed(admin.cookie);
    const second = await issueClinicFeed(admin.cookie);

    expect((await fetchFeed(first.url)).status).toBe(404);
    expect((await fetchFeed(second.url)).status).toBe(200);
    const active = await db.select().from(icsFeedTokens).where(eq(icsFeedTokens.scope, 'clinic'));
    expect(active.filter((r) => r.revokedAt === null)).toHaveLength(1);
    expect(active.find((r) => r.revokedAt !== null)?.tokenPrefix).toBe(first.prefix);
    expect(await audits('ics_feed.revoke')).toHaveLength(1);
    expect(await audits('ics_feed.issue')).toHaveLength(2);
  });

  it('keeps one active feed per room; a room feed needs an existing room (422 on roomId)', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    await issueClinicFeed(admin.cookie, { scope: 'room', roomId: principal.id });
    await issueClinicFeed(admin.cookie, { scope: 'room', roomId: secundaria.id });
    await issueClinicFeed(admin.cookie, { scope: 'room', roomId: principal.id });
    const missing = await call('POST', '/admin/integrations/calendar/feeds', admin.cookie, {
      scope: 'room',
    });
    const unknown = await call('POST', '/admin/integrations/calendar/feeds', admin.cookie, {
      scope: 'room',
      roomId: '00000000-0000-4000-8000-000000000000',
    });

    expect(missing.status).toBe(422);
    expect(missing.error?.details?.[0]?.path).toBe('roomId');
    expect(unknown.status).toBe(422);
    expect(unknown.error?.details?.[0]?.path).toBe('roomId');
    const listed = (await call('GET', '/admin/integrations/calendar', admin.cookie)).body as {
      feeds: { scope: string; roomName: string | null }[];
    };
    expect(listed.feeds.map((f) => [f.scope, f.roomName]).sort()).toEqual([
      ['room', 'Sala Principal'],
      ['room', 'Sala Secundária'],
    ]);
  });

  it('DELETE revokes a feed with audit; the URL then answers 404 and a second DELETE 404', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const issued = await issueClinicFeed(admin.cookie);
    const [row] = await db.select().from(icsFeedTokens);

    const res = await call(
      'DELETE',
      `/admin/integrations/calendar/feeds/${row?.id ?? ''}`,
      admin.cookie,
    );
    const again = await call(
      'DELETE',
      `/admin/integrations/calendar/feeds/${row?.id ?? ''}`,
      admin.cookie,
    );

    expect(res.status).toBe(204);
    expect(again.status).toBe(404);
    const [revoked] = await db.select().from(icsFeedTokens);
    expect(revoked?.revokedAt?.toISOString()).toBe(NOW.toISOString());
    const [entry] = await audits('ics_feed.revoke');
    expect(entry).toMatchObject({ entityId: row?.id, actorUserId: admin.user.id });
    expect((await fetchFeed(issued.url)).status).toBe(404);
  });

  it('answers 403 to reception on every calendar integration route (GES-120)', async () => {
    const reception = await createStaff(db, 'reception', NOW);
    const id = '00000000-0000-4000-8000-000000000000';

    const results = [
      await call('GET', '/admin/integrations/calendar', reception.cookie),
      await call('POST', '/admin/integrations/calendar/feeds', reception.cookie, {
        scope: 'clinic',
      }),
      await call('DELETE', `/admin/integrations/calendar/feeds/${id}`, reception.cookie),
    ];

    expect(results.map((r) => [r.status, r.error?.code])).toEqual([
      [403, 'FORBIDDEN'],
      [403, 'FORBIDDEN'],
      [403, 'FORBIDDEN'],
    ]);
    expect(await db.select().from(icsFeedTokens)).toHaveLength(0);
  });
});

describe('clinic feed contents (GES-44, GES-47, GES-48)', () => {
  it('lists every allowed status and active blocks, never cancelled/expired bookings or amounts', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const { user } = await createTenant(db, { now: NOW, name: 'Joana Prado Silva' });
    const day = addDays(TODAY, 7);
    const included = [
      'pre_reserved',
      'awaiting_payment',
      'held_for_renewal',
      'confirmed',
      'paid',
      'completed',
      'no_show',
    ];
    const rows: BookingRow[] = [];
    for (const [i, status] of included.entries()) {
      rows.push(await booking(user.id, principal.id, at(day, 540 + i * 60), { status }));
    }
    const excluded: BookingRow[] = [];
    for (const [i, status] of [
      'cancelled_by_tenant',
      'cancelled_nonpayment',
      'cancelled_by_clinic',
      'expired',
    ].entries()) {
      excluded.push(await booking(user.id, principal.id, at(day, 1000 + i * 60), { status }));
    }
    const [block] = await db
      .insert(blocks)
      .values({
        roomId: secundaria.id,
        tag: 'Manutenção',
        startsAt: at(day, 600),
        endsAt: at(day, 720),
      })
      .returning();
    await db.insert(blocks).values({
      roomId: secundaria.id,
      tag: 'Cancelado',
      startsAt: at(day, 800),
      endsAt: at(day, 860),
      cancelledAt: NOW,
    });
    const issued = await issueClinicFeed(admin.cookie);

    const feed = await fetchFeed(issued.url);

    expect(feed.status).toBe(200);
    expect(feed.headers.get('Content-Type')).toBe('text/calendar; charset=utf-8');
    expect(feed.headers.get('Cache-Control')).toBe('private, max-age=300');
    const list = events(feed.text);
    expect(list.map((e) => e.uid).sort()).toEqual(
      [...rows.map((r) => r.icsUid), `block-${block?.id ?? ''}@bravo-clinic`].sort(),
    );
    for (const row of excluded) expect(feed.text).not.toContain(row.icsUid);
    const byUid = new Map(list.map((e) => [e.uid, e]));
    expect(byUid.get(rows[3]?.icsUid ?? '')).toMatchObject({
      summary: 'Joana · Sala Principal',
      dtstart: icsUtc(at(day, 720)),
      status: 'CONFIRMED',
    });
    expect(byUid.get(rows[0]?.icsUid ?? '')?.status).toBe('TENTATIVE');
    expect(byUid.get(rows[2]?.icsUid ?? '')?.status).toBe('TENTATIVE');
    expect(byUid.get(`block-${block?.id ?? ''}@bravo-clinic`)).toMatchObject({
      summary: 'Manutenção · Sala Secundária',
      sequence: 0,
    });
    // The 30-min cleanup buffer is not an event, and no amount or e-mail leaks into the feed.
    expect(feed.text.match(/BEGIN:VEVENT/g)).toHaveLength(8);
    expect(feed.text).not.toMatch(/R\$|12345|123,45/);
    expect(feed.text).not.toContain(user.email);
    expect(feed.text).not.toContain('Prado');
    expect(feed.text).toContain('METHOD:PUBLISH');
  });

  it('room scope keeps only that room; window edges today − 90 and today + 180 are included', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const { user } = await createTenant(db, { now: NOW });
    const firstIn = await booking(user.id, principal.id, at(addDays(TODAY, -90), 0));
    const beforeWindow = await booking(user.id, principal.id, at(addDays(TODAY, -91), 1380));
    const lastIn = await booking(user.id, principal.id, at(addDays(TODAY, 180), 1380));
    const afterWindow = await booking(user.id, principal.id, at(addDays(TODAY, 181), 0));
    const otherRoom = await booking(user.id, secundaria.id, at(addDays(TODAY, 3), 600));
    const clinic = await issueClinicFeed(admin.cookie);
    const room = await issueClinicFeed(admin.cookie, { scope: 'room', roomId: principal.id });

    const clinicUids = events((await fetchFeed(clinic.url)).text).map((e) => e.uid);
    const roomUids = events((await fetchFeed(room.url)).text).map((e) => e.uid);

    expect(clinicUids.sort()).toEqual([firstIn.icsUid, lastIn.icsUid, otherRoom.icsUid].sort());
    expect(roomUids.sort()).toEqual([firstIn.icsUid, lastIn.icsUid].sort());
    expect(clinicUids).not.toContain(beforeWindow.icsUid);
    expect(clinicUids).not.toContain(afterWindow.icsUid);
  });
});

describe('personal feed (GES-45, GES-46)', () => {
  it('issues one feed per user and lists only the owner’s allowed statuses', async () => {
    const { user, cookie } = await createTenant(db, { now: NOW });
    const stranger = await createTenant(db, { now: NOW });
    const day = addDays(TODAY, 2);
    const shown: BookingRow[] = [];
    for (const [i, status] of ['held_for_renewal', 'confirmed', 'paid', 'completed'].entries()) {
      shown.push(await booking(user.id, principal.id, at(day, 540 + i * 60), { status }));
    }
    const hidden = [
      await booking(user.id, principal.id, at(day, 900), { status: 'pre_reserved' }),
      await booking(user.id, principal.id, at(day, 960), { status: 'awaiting_payment' }),
      await booking(user.id, principal.id, at(day, 1020), { status: 'no_show' }),
      await booking(user.id, principal.id, at(addDays(TODAY, -31), 600)),
      await booking(stranger.user.id, secundaria.id, at(day, 600)),
    ];
    const recent = await booking(user.id, secundaria.id, at(addDays(TODAY, -30), 0));

    const before = await call('GET', '/app/calendar-feed', cookie);
    const issued = await call('POST', '/app/calendar-feed', cookie);
    const after = await call('GET', '/app/calendar-feed', cookie);

    expect(before.body).toEqual({ active: false, prefix: null, createdAt: null });
    expect(issued.status).toBe(201);
    const url = (issued.body as { url: string }).url;
    const token = URL_PATTERN.exec(url)?.[1] ?? '';
    expect(after.body).toEqual({
      active: true,
      prefix: token.slice(0, 6),
      createdAt: NOW.toISOString(),
    });
    const [row] = await db.select().from(icsFeedTokens);
    expect(row).toMatchObject({ scope: 'user', userId: user.id, tokenHash: sha256Hex(token) });
    const feed = await fetchFeed(url);
    const list = events(feed.text);
    expect(list.map((e) => e.uid).sort()).toEqual(
      [...shown.map((b) => b.icsUid), recent.icsUid].sort(),
    );
    for (const b of hidden) expect(feed.text).not.toContain(b.icsUid);
    expect(list[0]?.summary).toBe('Bravô Clinic · Sala Secundária');
    expect(list.find((e) => e.uid === shown[0]?.icsUid)?.summary).toBe(
      'Bravô Clinic · Sala Principal',
    );
    expect(feed.text).not.toContain('Locatário');
    expect((await audits('ics_feed.issue'))[0]).toMatchObject({
      actorUserId: user.id,
      origin: 'app',
    });
  });

  it('regenerating revokes the previous personal URL; DELETE revokes the current one', async () => {
    const { cookie } = await createTenant(db, { now: NOW });
    const first = (await call('POST', '/app/calendar-feed', cookie)).body as { url: string };
    const second = (await call('POST', '/app/calendar-feed', cookie)).body as { url: string };

    expect((await fetchFeed(first.url)).status).toBe(404);
    expect((await fetchFeed(second.url)).status).toBe(200);

    const removed = await call('DELETE', '/app/calendar-feed', cookie);
    expect(removed.status).toBe(204);
    expect((await fetchFeed(second.url)).status).toBe(404);
    expect((await call('GET', '/app/calendar-feed', cookie)).body).toMatchObject({ active: false });
    expect(await audits('ics_feed.revoke')).toHaveLength(2);
  });
});

describe('feed updates after reschedule and cancellation (GES-49)', () => {
  it('keeps the UID with the new DTSTART and SEQUENCE + 1, and drops a cancelled booking', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const { user } = await createTenant(db, { now: NOW });
    const day = addDays(TODAY, 7);
    const row = await insertBooking(db, {
      userId: user.id,
      roomId: principal.id,
      startsAt: at(day, 840),
      endsAt: at(day, 900),
      totalCents: 9700,
      paidCents: 4851,
      depositCents: 4851,
    });
    const issued = await issueClinicFeed(admin.cookie);
    const original = events((await fetchFeed(issued.url)).text).find((e) => e.uid === row.icsUid);

    const target = addDays(TODAY, 14);
    const moved = await call('POST', `/admin/bookings/${row.id}/reschedule`, admin.cookie, {
      date: target,
      startMinute: 840,
      endMinute: 900,
    });
    expect(moved.status).toBe(200);
    const rescheduled = events((await fetchFeed(issued.url)).text).find(
      (e) => e.uid === row.icsUid,
    );

    expect(original?.dtstart).toBe(icsUtc(at(day, 840)));
    expect(rescheduled?.dtstart).toBe(icsUtc(at(target, 840)));
    expect(rescheduled?.sequence).toBe((original?.sequence ?? -1) + 1);

    await db
      .update(bookings)
      .set({ status: 'cancelled_by_clinic', cancelledAt: NOW })
      .where(eq(bookings.id, row.id));
    expect((await fetchFeed(issued.url)).text).not.toContain(row.icsUid);
  });
});

describe('GET /ics/:token.ics errors (GES-51, GES-52)', () => {
  it('answers the same 404 to malformed, unknown and revoked tokens', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const first = await issueClinicFeed(admin.cookie);
    await issueClinicFeed(admin.cookie);

    const responses = [
      await fetchFeed('/ics/xxxxxxxx.ics'),
      await fetchFeed(`/ics/${'A'.repeat(43)}.ics`),
      await fetchFeed(first.url),
      await fetchFeed(first.url.replace('.ics', '')),
    ];

    expect(responses.map((r) => r.status)).toEqual([404, 404, 404, 404]);
    const bodies = responses.map(
      (r) => (JSON.parse(r.text) as { error: { code: string; message: string } }).error,
    );
    expect(new Set(bodies.map((b) => `${b.code}|${b.message}`)).size).toBe(1);
    expect(bodies[0]?.code).toBe('NOT_FOUND');
  });

  it('answers 429 with Retry-After on the 61st request of the hour', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const issued = await issueClinicFeed(admin.cookie);
    const [row] = await db.select().from(icsFeedTokens);
    const windowStart = new Date(Math.floor(NOW.getTime() / 3_600_000) * 3_600_000);
    // 59 fetches already happened in this hour.
    await db
      .insert(rateLimitBuckets)
      .values({ key: feedRateLimitKey(row?.id ?? ''), windowStart, count: 59 });

    const sixtieth = await fetchFeed(issued.url);
    const sixtyFirst = await fetchFeed(issued.url);

    expect(sixtieth.status).toBe(200);
    expect(sixtyFirst.status).toBe(429);
    // NOW is on the hour, so the window has its full hour left.
    expect(sixtyFirst.headers.get('Retry-After')).toBe('3600');
    const [bucket] = await db
      .select()
      .from(rateLimitBuckets)
      .where(and(eq(rateLimitBuckets.key, feedRateLimitKey(row?.id ?? ''))));
    expect(bucket?.count).toBe(61);
  });
});

describe('GET /app/bookings/:id/ics (GES-50)', () => {
  it('answers METHOD:PUBLISH with one VEVENT, and METHOD:CANCEL + STATUS:CANCELLED once cancelled', async () => {
    const { user, cookie } = await createTenant(db, { now: NOW });
    const active = await booking(user.id, principal.id, at(addDays(TODAY, 3), 600));
    const cancelled = await booking(user.id, principal.id, at(addDays(TODAY, 4), 600), {
      status: 'cancelled_by_tenant',
    });

    const publish = await app().request(`/app/bookings/${active.id}/ics`, {
      headers: { Cookie: cookie },
    });
    const cancel = await app().request(`/app/bookings/${cancelled.id}/ics`, {
      headers: { Cookie: cookie },
    });
    const publishText = await publish.text();
    const cancelText = await cancel.text();

    expect(publish.status).toBe(200);
    expect(publish.headers.get('Content-Type')).toContain('text/calendar');
    expect(publishText).toContain('METHOD:PUBLISH');
    expect(events(publishText)).toHaveLength(1);
    expect(events(publishText)[0]?.uid).toBe(active.icsUid);
    expect(cancel.status).toBe(200);
    expect(cancelText).toContain('METHOD:CANCEL');
    expect(events(cancelText)).toHaveLength(1);
    expect(events(cancelText)[0]?.status).toBe('CANCELLED');
  });
});
