import { settingDefaults } from '@bravo/core';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStaff } from '../../../test/booking-helpers';
import { forbiddenFetch, send, testEnv } from '../../../test/http';
import { requireTestDatabaseUrl } from '../../../test/require-test-db';
import { createApp } from '../../app';
import { createDb } from '../../db/client';
import { auditLog, emailOutbox, notificationRecipients, rateLimitBuckets } from '../../db/schema';
import { runSeed } from '../../db/seed';
import { rateLimitKey } from '../../middleware/rate-limit';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

const NOW = new Date('2027-03-10T15:00:00.000Z');
const DAY = 86_400_000;
const BASE = '/admin/integrations/notifications';

beforeEach(async () => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  await runSeed(db);
});

const buildApp = (opts: { fetch?: typeof fetch; env?: Record<string, string> } = {}) =>
  createApp({ db, now: () => NOW, fetch: opts.fetch ?? forbiddenFetch, env: testEnv(opts.env) });

const call = (cookie: string, method: string, path: string, body?: unknown, app = buildApp()) =>
  send(app, method, path, { cookie, ...(body !== undefined && { body }) });

const audits = (action: string) => db.select().from(auditLog).where(eq(auditLog.action, action));

describe('notification recipients (GES-65)', () => {
  it('stores the lower-cased e-mail as active with audit and answers 409 to a duplicate', async () => {
    const admin = await createStaff(db, 'admin', NOW);

    const created = await call(admin.cookie, 'POST', `${BASE}/recipients`, {
      email: 'Gerencia@BravoClinic.com.br',
    });
    const duplicate = await call(admin.cookie, 'POST', `${BASE}/recipients`, {
      email: 'gerencia@bravoclinic.com.br',
    });

    expect(created.status).toBe(201);
    expect(created.body).toEqual({
      id: expect.any(String) as string,
      email: 'gerencia@bravoclinic.com.br',
      active: true,
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.error?.code).toBe('CONFLICT');
    expect(await db.select().from(notificationRecipients)).toHaveLength(1);
    const [entry] = await audits('notification_recipient.create');
    expect(entry).toMatchObject({
      actorUserId: admin.user.id,
      entityId: (created.body as { id: string }).id,
      after: { email: 'gerencia@bravoclinic.com.br', active: true },
    });
  });

  it('refuses the 11th recipient with 422 POLICY_VIOLATION', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    await db
      .insert(notificationRecipients)
      .values(Array.from({ length: 10 }, (_, i) => ({ email: `r${String(i)}@bravoclinic.test` })));

    const res = await call(admin.cookie, 'POST', `${BASE}/recipients`, {
      email: 'onze@bravoclinic.test',
    });

    expect(res.status).toBe(422);
    expect(res.error?.code).toBe('POLICY_VIOLATION');
    expect(await db.select().from(notificationRecipients)).toHaveLength(10);
  });

  it('toggles and removes a recipient with audit; an unknown id is 404', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const created = (
      await call(admin.cookie, 'POST', `${BASE}/recipients`, { email: 'a@bravoclinic.test' })
    ).body as { id: string };

    const toggled = await call(admin.cookie, 'PATCH', `${BASE}/recipients/${created.id}`, {
      active: false,
    });
    const listed = await call(admin.cookie, 'GET', BASE);
    const removed = await call(admin.cookie, 'DELETE', `${BASE}/recipients/${created.id}`);
    const missing = await call(admin.cookie, 'PATCH', `${BASE}/recipients/${created.id}`, {
      active: true,
    });

    expect(toggled.status).toBe(200);
    expect(toggled.body).toEqual({ id: created.id, email: 'a@bravoclinic.test', active: false });
    expect((listed.body as { recipients: unknown[] }).recipients).toEqual([
      { id: created.id, email: 'a@bravoclinic.test', active: false },
    ]);
    expect(removed.status).toBe(204);
    expect(missing.status).toBe(404);
    expect(await db.select().from(notificationRecipients)).toHaveLength(0);
    const [update] = await audits('notification_recipient.update');
    expect(update).toMatchObject({ before: { active: true }, after: { active: false } });
    const [deletion] = await audits('notification_recipient.delete');
    expect(deletion).toMatchObject({
      entityId: created.id,
      before: { email: 'a@bravoclinic.test' },
    });
  });
});

describe('event toggles and provider status (GES-66, GES-74)', () => {
  it('round-trips the 7 toggles with audit and refuses an unknown key with 422', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const events = {
      ...settingDefaults()['notifications.events'],
      new_booking: false,
      new_quote_request: false,
    };

    const saved = await call(admin.cookie, 'PUT', `${BASE}/events`, events);
    const unknown = await call(admin.cookie, 'PUT', `${BASE}/events`, {
      ...events,
      birthday: true,
    });
    const listed = await call(admin.cookie, 'GET', BASE);

    expect(saved.status).toBe(200);
    expect(saved.body).toEqual(events);
    expect(unknown.status).toBe(422);
    expect(unknown.error?.code).toBe('VALIDATION_FAILED');
    expect((listed.body as { events: unknown }).events).toEqual(events);
    const [entry] = await audits('notification_events.update');
    expect(entry).toMatchObject({ entityId: 'notifications.events', after: events });
  });

  it('reports whether the e-mail provider is configured', async () => {
    const admin = await createStaff(db, 'admin', NOW);

    const without = await call(admin.cookie, 'GET', BASE);
    const withKey = await call(
      admin.cookie,
      'GET',
      BASE,
      undefined,
      buildApp({ env: { RESEND_API_KEY: 're_test_key' } }),
    );

    expect(without.body).toMatchObject({ providerConfigured: false, recipients: [] });
    expect(withKey.body).toMatchObject({ providerConfigured: true });
  });
});

describe('POST /admin/integrations/notifications/test (GES-70)', () => {
  it('queues system.test to every active recipient and returns each final status', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    await db
      .insert(notificationRecipients)
      .values([
        { email: 'um@bravoclinic.test' },
        { email: 'dois@bravoclinic.test' },
        { email: 'inativo@bravoclinic.test', active: false },
      ]);
    const sentTo: string[] = [];
    const resend: typeof fetch = (input, init) => {
      const url = input instanceof Request ? input.url : input.toString();
      expect(url).toBe('https://api.resend.com/emails');
      sentTo.push(...(JSON.parse(init?.body as string) as { to: string[] }).to);
      return Promise.resolve(Response.json({ id: `re_${String(sentTo.length)}` }));
    };

    const res = await call(
      admin.cookie,
      'POST',
      `${BASE}/test`,
      {},
      buildApp({ fetch: resend, env: { RESEND_API_KEY: 're_test_key' } }),
    );

    expect(res.status).toBe(200);
    const results = (res.body as { results: { to: string; status: string }[] }).results;
    expect(results.sort((a, b) => a.to.localeCompare(b.to))).toEqual([
      { to: 'dois@bravoclinic.test', status: 'sent' },
      { to: 'um@bravoclinic.test', status: 'sent' },
    ]);
    expect(sentTo.sort()).toEqual(['dois@bravoclinic.test', 'um@bravoclinic.test']);
    const rows = await db.select().from(emailOutbox);
    expect(rows.map((r) => r.template)).toEqual(['system.test', 'system.test']);
  });

  it('answers not_sent without a provider key, and sends only to the address given', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    await db.insert(notificationRecipients).values({ email: 'um@bravoclinic.test' });

    const res = await call(admin.cookie, 'POST', `${BASE}/test`, { to: 'Outro@Bravoclinic.test' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ results: [{ to: 'outro@bravoclinic.test', status: 'not_sent' }] });
  });

  it('answers 429 on the 6th test of the hour', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const windowStart = new Date(Math.floor(NOW.getTime() / 3_600_000) * 3_600_000);
    await db.insert(rateLimitBuckets).values({
      key: rateLimitKey('email_test', admin.user.id),
      windowStart,
      count: 4,
    });

    const fifth = await call(admin.cookie, 'POST', `${BASE}/test`, {});
    const sixth = await call(admin.cookie, 'POST', `${BASE}/test`, {});

    expect(fifth.status).toBe(200);
    expect(sixth.status).toBe(429);
    expect(sixth.error?.code).toBe('TOO_MANY_ATTEMPTS');
    expect(sixth.headers.get('Retry-After')).toBe('3600');
  });
});

describe('GET /admin/integrations/outbox (GES-71)', () => {
  it('lists the last 30 days newest first, filters by status and never returns HTML', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const row = (subject: string, ageDays: number, status: string) => ({
      toAddress: 'x@bravoclinic.test',
      template: 'system.test',
      subject,
      html: '<p>secreto</p>',
      textBody: 'texto',
      status,
      attempts: status === 'failed' ? 2 : 0,
      lastError: status === 'failed' ? 'Resend responded 500' : null,
      createdAt: new Date(NOW.getTime() - ageDays * DAY),
    });
    await db
      .insert(emailOutbox)
      .values([
        row('recente', 1, 'sent'),
        row('falhou', 2, 'failed'),
        row('limite', 29.9, 'sent'),
        row('antigo', 31, 'sent'),
      ]);

    const all = await call(admin.cookie, 'GET', '/admin/integrations/outbox');
    const failed = await call(admin.cookie, 'GET', '/admin/integrations/outbox?status=failed');

    expect(all.status).toBe(200);
    const items = (all.body as { items: Record<string, unknown>[]; nextCursor: unknown }).items;
    expect(items.map((i) => i.subject)).toEqual(['recente', 'falhou', 'limite']);
    expect(Object.keys(items[0] ?? {}).sort()).toEqual([
      'attempts',
      'createdAt',
      'id',
      'lastError',
      'sentAt',
      'status',
      'subject',
      'template',
      'to',
    ]);
    expect(JSON.stringify(all.body)).not.toContain('secreto');
    expect((all.body as { nextCursor: unknown }).nextCursor).toBeNull();
    expect((failed.body as { items: Record<string, unknown>[] }).items).toEqual([
      expect.objectContaining({
        subject: 'falhou',
        status: 'failed',
        attempts: 2,
        lastError: 'Resend responded 500',
        to: 'x@bravoclinic.test',
        createdAt: new Date(NOW.getTime() - 2 * DAY).toISOString(),
        sentAt: null,
      }),
    ]);
  });

  it('pages with an opaque cursor and answers 403 to reception', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const reception = await createStaff(db, 'reception', NOW);
    await db.insert(emailOutbox).values(
      Array.from({ length: 51 }, (_, i) => ({
        toAddress: 'x@bravoclinic.test',
        template: 'system.test',
        subject: `m${String(i)}`,
        html: '',
        textBody: '',
        createdAt: new Date(NOW.getTime() - (i + 1) * 60_000),
      })),
    );

    const first = await call(admin.cookie, 'GET', '/admin/integrations/outbox');
    const cursor = (first.body as { nextCursor: string }).nextCursor;
    const second = await call(admin.cookie, 'GET', `/admin/integrations/outbox?cursor=${cursor}`);
    const forbidden = await call(reception.cookie, 'GET', '/admin/integrations/outbox');
    const forbiddenAdd = await call(reception.cookie, 'POST', `${BASE}/recipients`, {
      email: 'x@bravoclinic.test',
    });

    expect((first.body as { items: unknown[] }).items).toHaveLength(50);
    expect((second.body as { items: { subject: string }[] }).items.map((i) => i.subject)).toEqual([
      'm50',
    ]);
    expect(forbidden.status).toBe(403);
    expect(forbiddenAdd.status).toBe(403);
  });
});
