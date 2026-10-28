import { localToUtc } from '@bravo/core';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStaff, createTenant, seededRoom } from '../../../test/booking-helpers';
import { createBooking as insertBooking } from '../../../test/factories';
import { forbiddenFetch, send, testEnv } from '../../../test/http';
import { connectMcp } from '../../../test/mcp-client';
import { requireTestDatabaseUrl } from '../../../test/require-test-db';
import { createApp } from '../../app';
import { createDb, withTransaction } from '../../db/client';
import {
  auditLog,
  emailOutbox,
  extraServices,
  notificationRecipients,
  quoteRequests,
} from '../../db/schema';
import { runSeed } from '../../db/seed';
import { saveSetting } from '../../modules/settings/settings.repo';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

// Tuesday 2027-03-02 12:00 BRT.
const NOW = new Date('2027-03-02T15:00:00.000Z');

let serviceId = '';
beforeEach(async () => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  await runSeed(db);
  const [videomaker] = await db
    .select()
    .from(extraServices)
    .where(eq(extraServices.name, 'Videomaker'));
  serviceId = videomaker!.id;
});

const buildApp = () => createApp({ db, now: () => NOW, fetch: forbiddenFetch, env: testEnv() });
const call = (cookie: string | undefined, method: string, path: string, body?: unknown) =>
  send(buildApp(), method, path, {
    ...(cookie !== undefined && { cookie }),
    ...(body !== undefined && { body }),
  });

let ipCounter = 0;
/** Each test posts from its own IP unless it passes one, so the 5/hour limit stays per test. */
const post = (body: unknown, opts: { cookie?: string; ip?: string } = {}) => {
  ipCounter += 1;
  return send(buildApp(), 'POST', '/public/quote-requests', {
    body,
    ...(opts.cookie !== undefined && { cookie: opts.cookie }),
    headers: { 'X-Forwarded-For': opts.ip ?? `198.51.100.${String(ipCounter % 250)}` },
  });
};

const request = (overrides: Record<string, unknown> = {}) => ({
  serviceId,
  name: 'Ana Souza',
  phone: '(47) 99999-1234',
  email: 'ana@example.test',
  description: 'Quero gravar quatro vídeos curtos para Reels.',
  desiredOn: '2027-03-20',
  website: '',
  ...overrides,
});

const audits = (action: string) => db.select().from(auditLog).where(eq(auditLog.action, action));

async function quoteRow(
  status: string,
  overrides: Partial<typeof quoteRequests.$inferInsert> = {},
) {
  const [row] = await db
    .insert(quoteRequests)
    .values({
      serviceId,
      name: 'Bruno Lima',
      phone: '+5547999991234',
      description: 'Preciso de um videomaker',
      status,
      ...overrides,
    })
    .returning();
  return row!;
}

describe('POST /public/quote-requests (GES-90..GES-93)', () => {
  it('stores an anonymous request as new (201) without a user', async () => {
    const res = await post(request());

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      status: 'new',
      serviceName: 'Videomaker',
      description: 'Quero gravar quatro vídeos curtos para Reels.',
      desiredOn: '2027-03-20',
      bookingCode: null,
    });
    const [row] = await db.select().from(quoteRequests);
    expect(row).toMatchObject({
      serviceId,
      userId: null,
      bookingId: null,
      name: 'Ana Souza',
      phone: '+5547999991234',
      email: 'ana@example.test',
      status: 'new',
      source: 'web',
    });
  });

  it('links the session user and their own booking (201)', async () => {
    const { user, cookie } = await createTenant(db, { now: NOW });
    const room = await seededRoom(db);
    const booking = await insertBooking(db, {
      userId: user.id,
      roomId: room.id,
      startsAt: localToUtc('2027-03-09', 840),
      endsAt: localToUtc('2027-03-09', 960),
    });

    const res = await post(request({ bookingId: booking.id }), { cookie });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ bookingCode: booking.code });
    const [row] = await db.select().from(quoteRequests);
    expect(row).toMatchObject({ userId: user.id, bookingId: booking.id, source: 'app' });
  });

  it('answers 422 on bookingId for another user’s booking or without a session, and on an inactive service', async () => {
    const owner = await createTenant(db, { now: NOW });
    const other = await createTenant(db, { now: NOW });
    const room = await seededRoom(db);
    const booking = await insertBooking(db, {
      userId: owner.user.id,
      roomId: room.id,
      startsAt: localToUtc('2027-03-09', 840),
      endsAt: localToUtc('2027-03-09', 960),
    });
    await db
      .update(extraServices)
      .set({ status: 'inactive' })
      .where(eq(extraServices.name, 'Marketing digital'));
    const [inactive] = await db
      .select()
      .from(extraServices)
      .where(eq(extraServices.name, 'Marketing digital'));

    const foreign = await post(request({ bookingId: booking.id }), { cookie: other.cookie });
    const anonymous = await post(request({ bookingId: booking.id }));
    const unavailable = await post(request({ serviceId: inactive!.id }));

    for (const res of [foreign, anonymous]) {
      expect([res.status, res.error?.code, res.error?.details?.[0]?.path]).toEqual([
        422,
        'VALIDATION_FAILED',
        'bookingId',
      ]);
    }
    expect([unavailable.status, unavailable.error?.details?.[0]?.path]).toEqual([422, 'serviceId']);
    expect(await db.select().from(quoteRequests)).toHaveLength(0);
  });

  it('answers 429 TOO_MANY_ATTEMPTS to the 6th request of one IP within the hour', async () => {
    const ip = '203.0.113.7';
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) statuses.push((await post(request(), { ip })).status);
    const sixth = await post(request(), { ip });
    const otherIp = await post(request(), { ip: '203.0.113.8' });

    expect(statuses).toEqual([201, 201, 201, 201, 201]);
    expect([sixth.status, sixth.error?.code]).toEqual([429, 'TOO_MANY_ATTEMPTS']);
    expect(sixth.headers.get('Retry-After')).not.toBeNull();
    expect(otherIp.status).toBe(201);
    expect(await db.select().from(quoteRequests)).toHaveLength(6);
  });

  it('answers 202 to a filled honeypot and stores nothing', async () => {
    await db.insert(notificationRecipients).values({ email: 'equipe@bravoclinic.test' });

    const res = await post(request({ website: 'http://spam.example' }));

    expect(res.status).toBe(202);
    expect(await db.select().from(quoteRequests)).toHaveLength(0);
    expect(await db.select().from(emailOutbox)).toHaveLength(0);
  });
});

describe('quote request notifications (GES-94)', () => {
  it('queues staff.new_quote_request per active recipient and quote.received to the requester', async () => {
    await db
      .insert(notificationRecipients)
      .values([
        { email: 'equipe@bravoclinic.test' },
        { email: 'socia@bravoclinic.test' },
        { email: 'antiga@bravoclinic.test', active: false },
      ]);

    const res = await post(request());

    expect(res.status).toBe(201);
    const rows = await db.select().from(emailOutbox);
    const staff = rows.filter((r) => r.template === 'staff.new_quote_request');
    expect(staff.map((r) => r.toAddress).sort()).toEqual([
      'equipe@bravoclinic.test',
      'socia@bravoclinic.test',
    ]);
    expect(staff[0]?.subject).toBe('Novo pedido de orçamento: Videomaker');
    const received = rows.filter((r) => r.template === 'quote.received');
    expect(received.map((r) => [r.toAddress, r.subject])).toEqual([
      ['ana@example.test', 'Recebemos seu pedido de orçamento: Videomaker'],
    ]);
  });

  it('queues no quote.received without an e-mail, and no staff e-mail when the toggle is off', async () => {
    await db.insert(notificationRecipients).values({ email: 'equipe@bravoclinic.test' });
    const events = {
      new_booking: true,
      payment_received: true,
      booking_cancelled: true,
      new_subscription: true,
      renewal_failed: true,
      pre_reservation_expired: true,
      new_quote_request: false,
    };

    const withoutEmail = await post(request({ email: '' }));
    const first = await db.select().from(emailOutbox);
    await withTransaction(db, (tx) => saveSetting(tx, 'notifications.events', events, null));
    const toggledOff = await post(request());
    const after = await db.select().from(emailOutbox);

    expect([withoutEmail.status, toggledOff.status]).toEqual([201, 201]);
    expect(first.map((r) => r.template)).toEqual(['staff.new_quote_request']);
    expect(after.map((r) => r.template).sort()).toEqual([
      'quote.received',
      'staff.new_quote_request',
    ]);
  });
});

describe('PATCH /admin/quote-requests/:id (GES-95, GES-96)', () => {
  it('applies every valid move with audit quote_request.status', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const forward = await quoteRow('new');
    const fromNew = await quoteRow('new');
    const fromContacted = await quoteRow('contacted');
    const fromSent = await quoteRow('quote_sent');

    const moves: [string, string][] = [
      [forward.id, 'contacted'],
      [forward.id, 'quote_sent'],
      [forward.id, 'won'],
      [fromNew.id, 'lost'],
      [fromContacted.id, 'lost'],
      [fromSent.id, 'lost'],
    ];
    const results: [number, unknown][] = [];
    for (const [id, status] of moves) {
      const res = await call(admin.cookie, 'PATCH', `/admin/quote-requests/${id}`, { status });
      results.push([res.status, (res.body as { status: string }).status]);
    }

    expect(results).toEqual(moves.map(([, status]) => [200, status]));
    const entries = await audits('quote_request.status');
    expect(entries).toHaveLength(6);
    expect(
      entries.filter((e) => e.entityId === forward.id).map((e) => [e.before, e.after]),
    ).toEqual([
      [{ status: 'new' }, { status: 'contacted' }],
      [{ status: 'contacted' }, { status: 'quote_sent' }],
      [{ status: 'quote_sent' }, { status: 'won' }],
    ]);
  });

  // GES-95 allows ONLY these moves; every other (from, to) pair of the 5 statuses, the same
  // status included, is refused. Written from the spec, not from the service's table.
  const STATUSES = ['new', 'contacted', 'quote_sent', 'won', 'lost'] as const;
  const ALLOWED = new Set([
    'new>contacted',
    'new>lost',
    'contacted>quote_sent',
    'contacted>lost',
    'quote_sent>won',
    'quote_sent>lost',
  ]);
  const DISALLOWED = STATUSES.flatMap((from) =>
    STATUSES.filter((to) => !ALLOWED.has(`${from}>${to}`)).map((to) => [from, to] as const),
  );

  it('refuses 19 of the 25 (from, to) pairs', () => {
    expect(DISALLOWED).toHaveLength(19);
  });

  it.each(DISALLOWED)(
    'answers 409 INVALID_TRANSITION to %s → %s, leaving the row and the audit log untouched',
    async (from, to) => {
      const admin = await createStaff(db, 'admin', NOW);
      const row = await quoteRow(from);

      const res = await call(admin.cookie, 'PATCH', `/admin/quote-requests/${row.id}`, {
        status: to,
      });

      expect([res.status, res.error?.code]).toEqual([409, 'INVALID_TRANSITION']);
      const [stored] = await db.select().from(quoteRequests).where(eq(quoteRequests.id, row.id));
      expect(stored).toEqual(row);
      expect(await audits('quote_request.status')).toHaveLength(0);
    },
  );

  it('lets only one of two concurrent identical moves apply: one 200, one 409', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const row = await quoteRow('new');

    const results = await Promise.all([
      call(admin.cookie, 'PATCH', `/admin/quote-requests/${row.id}`, { status: 'contacted' }),
      call(admin.cookie, 'PATCH', `/admin/quote-requests/${row.id}`, { status: 'contacted' }),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)?.error?.code).toBe('INVALID_TRANSITION');
    expect(await audits('quote_request.status')).toHaveLength(1);
  });

  it('saves the staff notes with audit quote_request.notes; notes over 2000 chars are 422', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const row = await quoteRow('contacted');

    const saved = await call(admin.cookie, 'PATCH', `/admin/quote-requests/${row.id}`, {
      staffNotes: 'Ligar na sexta à tarde',
    });
    const tooLong = await call(admin.cookie, 'PATCH', `/admin/quote-requests/${row.id}`, {
      staffNotes: 'x'.repeat(2001),
    });

    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ status: 'contacted', staffNotes: 'Ligar na sexta à tarde' });
    const [stored] = await db.select().from(quoteRequests);
    expect(stored?.staffNotes).toBe('Ligar na sexta à tarde');
    const [entry] = await audits('quote_request.notes');
    expect(entry).toMatchObject({
      entityId: row.id,
      actorUserId: admin.user.id,
      before: { staffNotes: null },
      after: { staffNotes: 'Ligar na sexta à tarde' },
    });
    expect([tooLong.status, tooLong.error?.details?.[0]?.path]).toEqual([422, 'staffNotes']);
  });
});

describe('quote request lists (GES-96, GES-97)', () => {
  it('admin list is newest first with service, contact, booking code and notes, filterable by status', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const older = await quoteRow('new', { createdAt: new Date('2027-02-01T12:00:00Z') });
    const newer = await quoteRow('contacted', {
      createdAt: new Date('2027-02-10T12:00:00Z'),
      email: 'b@example.test',
      desiredOn: '2027-04-01',
      staffNotes: 'Retornar',
    });

    const all = await call(admin.cookie, 'GET', '/admin/quote-requests');
    const onlyNew = await call(admin.cookie, 'GET', '/admin/quote-requests?status=new');

    const body = all.body as { items: Record<string, unknown>[]; nextCursor: string | null };
    expect(body.items.map((i) => i['id'])).toEqual([newer.id, older.id]);
    expect(body.items[0]).toEqual({
      id: newer.id,
      status: 'contacted',
      serviceId,
      serviceName: 'Videomaker',
      name: 'Bruno Lima',
      phone: '+5547999991234',
      email: 'b@example.test',
      description: 'Preciso de um videomaker',
      desiredOn: '2027-04-01',
      bookingCode: null,
      staffNotes: 'Retornar',
      createdAt: '2027-02-10T12:00:00.000Z',
    });
    expect(body.nextCursor).toBeNull();
    expect((onlyNew.body as { items: { id: string }[] }).items.map((i) => i.id)).toEqual([
      older.id,
    ]);
  });

  it('reception gets 403 on the admin funnel', async () => {
    const reception = await createStaff(db, 'reception', NOW);
    const row = await quoteRow('new');

    const list = await call(reception.cookie, 'GET', '/admin/quote-requests');
    const move = await call(reception.cookie, 'PATCH', `/admin/quote-requests/${row.id}`, {
      status: 'contacted',
    });

    expect([list.status, move.status]).toEqual([403, 403]);
  });

  it('tenant list returns only the session user’s requests', async () => {
    const mine = await createTenant(db, { now: NOW });
    const theirs = await createTenant(db, { now: NOW });
    const own = await quoteRow('quote_sent', { userId: mine.user.id });
    await quoteRow('new', { userId: theirs.user.id });
    await quoteRow('new');

    const res = await call(mine.cookie, 'GET', '/app/quote-requests');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      items: [
        {
          id: own.id,
          status: 'quote_sent',
          serviceName: 'Videomaker',
          description: 'Preciso de um videomaker',
          desiredOn: null,
          bookingCode: null,
          createdAt: own.createdAt.toISOString(),
        },
      ],
      nextCursor: null,
    });
  });
});

describe('quote MCP tools', () => {
  it('quotes_list and quote_update_status run with origin mcp', async () => {
    await withTransaction(db, (tx) => saveSetting(tx, 'mcp.enabled', true, null));
    const admin = await createStaff(db, 'admin', NOW);
    const row = await quoteRow('new');
    const { token } = (
      await call(admin.cookie, 'POST', '/admin/integrations/mcp/tokens', {
        name: 'Assistente',
        scope: 'read_write',
      })
    ).body as { token: string };
    const client = await connectMcp(buildApp(), token);

    const listed = await client.callTool({ name: 'quotes_list', arguments: { status: 'new' } });
    const moved = await client.callTool({
      name: 'quote_update_status',
      arguments: { id: row.id, status: 'contacted', notes: 'Cliente pediu orçamento por e-mail' },
    });
    await client.close();

    expect(
      (listed.structuredContent as { items: { id: string }[] }).items.map((i) => i.id),
    ).toEqual([row.id]);
    expect(moved.structuredContent).toMatchObject({
      status: 'contacted',
      staffNotes: 'Cliente pediu orçamento por e-mail',
    });
    const [entry] = await audits('quote_request.status');
    expect(entry).toMatchObject({ origin: 'mcp', actorUserId: admin.user.id });
  });
});
