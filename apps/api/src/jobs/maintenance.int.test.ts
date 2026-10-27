import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createUser } from '../../test/factories';
import { forbiddenFetch, testEnv } from '../../test/http';
import { requireTestDatabaseUrl } from '../../test/require-test-db';
import { createApp } from '../app';
import { createDb } from '../db/client';
import {
  authTokens,
  emailOutbox,
  idempotencyKeys,
  jobRuns,
  rateLimitBuckets,
  sessions,
} from '../db/schema';
import { createRegistry } from '../extensions/registry';
import { getJob, runJob } from './index';
import { emailRetry, retention } from './maintenance';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

const NOW = new Date('2026-10-27T12:00:00.000Z');
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const ago = (ms: number) => new Date(NOW.getTime() - ms);

beforeEach(() => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

/** Resend stub: answers 200 with an id, or 500 when `fail` is set. */
function resend(fail = false) {
  return vi.fn((_url: string | URL | Request, init?: RequestInit) => {
    if (fail) return Promise.resolve(new Response('boom', { status: 500 }));
    const to = (JSON.parse(init?.body as string) as { to: string[] }).to[0] ?? '';
    return Promise.resolve(Response.json({ id: `msg-${to}` }));
  });
}

const jobDeps = (fetch: typeof globalThis.fetch = forbiddenFetch) => ({
  db,
  env: testEnv({ RESEND_API_KEY: 're_test' }),
  fetch,
  now: () => NOW,
  registry: createRegistry(),
});

async function outboxRow(to: string, values: Partial<typeof emailOutbox.$inferInsert>) {
  const [row] = await db
    .insert(emailOutbox)
    .values({
      toAddress: to,
      template: 'system.test',
      subject: 'S',
      html: '<p>h</p>',
      textBody: 't',
      ...values,
    })
    .returning();
  return row!;
}

describe('email-retry job (GES-72)', () => {
  async function scenario() {
    return {
      failedRecent: await outboxRow('a@x.test', {
        status: 'failed',
        attempts: 2,
        createdAt: ago(60 * MINUTE),
      }),
      failedExhausted: await outboxRow('b@x.test', {
        status: 'failed',
        attempts: 5,
        createdAt: ago(60 * MINUTE),
      }),
      failedOld: await outboxRow('c@x.test', {
        status: 'failed',
        attempts: 1,
        createdAt: ago(49 * 60 * MINUTE),
      }),
      pendingStale: await outboxRow('d@x.test', { status: 'pending', createdAt: ago(6 * MINUTE) }),
      pendingFresh: await outboxRow('e@x.test', { status: 'pending', createdAt: ago(2 * MINUTE) }),
    };
  }

  const statusOf = async (id: string) =>
    (await db.select().from(emailOutbox).where(eq(emailOutbox.id, id)))[0];

  it('dispatches failed rows with attempts < 5 from the last 48 h and pending rows older than 5 min', async () => {
    const rows = await scenario();
    const fetch = resend();

    const stats = await emailRetry(jobDeps(fetch), NOW);

    expect(stats).toEqual({ retried: 1, pending: 1 });
    const sentTo = fetch.mock.calls.map(
      (call) => (JSON.parse(call[1]?.body as string) as { to: string[] }).to[0],
    );
    expect(sentTo.sort()).toEqual(['a@x.test', 'd@x.test']);
    expect((await statusOf(rows.failedRecent.id))?.status).toBe('sent');
    expect((await statusOf(rows.pendingStale.id))?.status).toBe('sent');
    expect(await statusOf(rows.failedExhausted.id)).toMatchObject({
      status: 'failed',
      attempts: 5,
    });
    expect(await statusOf(rows.failedOld.id)).toMatchObject({ status: 'failed', attempts: 1 });
    expect((await statusOf(rows.pendingFresh.id))?.status).toBe('pending');
  });

  it('records another failed attempt when the provider fails again', async () => {
    const row = await outboxRow('a@x.test', {
      status: 'failed',
      attempts: 4,
      createdAt: ago(MINUTE * 30),
    });

    await emailRetry(jobDeps(resend(true)), NOW);
    expect(await statusOf(row.id)).toMatchObject({ status: 'failed', attempts: 5 });

    // At 5 attempts the row is no longer retried.
    const fetch = resend();
    expect(await emailRetry(jobDeps(fetch), NOW)).toEqual({ retried: 0, pending: 0 });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('retention job (GES-129)', () => {
  it('deletes only rows past each threshold, blanks 181-day-old outbox bodies and records the counts', async () => {
    const user = await createUser(db);
    const session = (values: Partial<typeof sessions.$inferInsert>) =>
      db
        .insert(sessions)
        .values({ userId: user.id, expiresAt: new Date(NOW.getTime() + DAY), ...values })
        .returning();
    await session({ expiresAt: ago(31 * DAY) });
    await session({ revokedAt: ago(31 * DAY) });
    const [expiredRecent] = await session({ expiresAt: ago(29 * DAY) });
    const [revokedRecent] = await session({ revokedAt: ago(29 * DAY) });
    const [active] = await session({});

    const token = (hash: string, values: Partial<typeof authTokens.$inferInsert>) =>
      db
        .insert(authTokens)
        .values({
          userId: user.id,
          purpose: 'password_reset',
          tokenHash: hash,
          expiresAt: new Date(NOW.getTime() + DAY),
          ...values,
        })
        .returning();
    await token('t1', { expiresAt: ago(31 * DAY) });
    await token('t2', { usedAt: ago(31 * DAY) });
    const [tokenRecent] = await token('t3', { expiresAt: ago(29 * DAY) });
    const [tokenUsedRecent] = await token('t4', { usedAt: ago(29 * DAY) });

    await db.insert(rateLimitBuckets).values([
      { key: 'old', windowStart: ago(3 * DAY), count: 1 },
      { key: 'new', windowStart: ago(1 * DAY), count: 1 },
    ]);
    const key = (k: string, expiresAt: Date) => ({
      userId: user.id,
      key: k,
      route: 'POST /app/bookings',
      requestHash: 'h',
      expiresAt,
    });
    await db
      .insert(idempotencyKeys)
      .values([key('expired', ago(MINUTE)), key('live', new Date(NOW.getTime() + DAY))]);

    const old = await outboxRow('old@x.test', {
      status: 'sent',
      createdAt: ago(181 * DAY),
      attachments: [{ filename: 'a.ics', contentType: 'text/calendar', contentBase64: 'QQ==' }],
    });
    const recent = await outboxRow('recent@x.test', { status: 'sent', createdAt: ago(179 * DAY) });

    const stats = await runJob('retention', retention, jobDeps(), 'inv-ret');

    const expected = {
      sessionsDeleted: 2,
      authTokensDeleted: 2,
      rateLimitBucketsDeleted: 1,
      idempotencyKeysDeleted: 1,
      outboxBodiesBlanked: 1,
    };
    expect(stats).toEqual(expected);
    const [run] = await db.select().from(jobRuns).where(eq(jobRuns.job, 'retention'));
    expect(run).toMatchObject({ status: 'ok', stats: expected, invocationId: 'inv-ret' });

    expect((await db.select().from(sessions)).map((s) => s.id).sort()).toEqual(
      [expiredRecent?.id, revokedRecent?.id, active?.id].sort(),
    );
    expect((await db.select().from(authTokens)).map((t) => t.id).sort()).toEqual(
      [tokenRecent?.id, tokenUsedRecent?.id].sort(),
    );
    expect((await db.select().from(rateLimitBuckets)).map((b) => b.key)).toEqual(['new']);
    expect((await db.select().from(idempotencyKeys)).map((k) => k.key)).toEqual(['live']);

    const outbox = await db.select().from(emailOutbox).orderBy(asc(emailOutbox.createdAt));
    expect(
      outbox.map((r) => [r.id, r.html, r.textBody, r.attachments, r.subject, r.toAddress]),
    ).toEqual([
      [old.id, '', '', [], 'S', 'old@x.test'],
      [recent.id, '<p>h</p>', 't', [], 'S', 'recent@x.test'],
    ]);
  });
});

describe('job routes (GES-72, GES-129)', () => {
  const app = (verified: boolean) =>
    createApp({
      db,
      now: () => NOW,
      fetch: forbiddenFetch,
      env: testEnv(),
      registry: createRegistry(),
      verifyTrigger: () => Promise.resolve(verified ? { invocationId: 'inv-1' } : null),
    });

  it('registers both jobs', () => {
    expect(getJob('email-retry')).toBe(emailRetry);
    expect(getJob('retention')).toBe(retention);
  });

  it.each(['email-retry', 'retention'])(
    'POST /jobs/%s without a valid trigger delivery answers 401 and runs nothing',
    async (name) => {
      const res = await app(false).request(`/jobs/${name}`, { method: 'POST', body: '{}' });

      expect(res.status).toBe(401);
      expect(await db.select().from(jobRuns)).toHaveLength(0);
    },
  );

  it.each(['email-retry', 'retention'])(
    'POST /jobs/%s with a delivery runs the job',
    async (name) => {
      const res = await app(true).request(`/jobs/${name}`, { method: 'POST', body: '{}' });

      expect(res.status).toBe(200);
      const [run] = await db.select().from(jobRuns);
      expect(run).toMatchObject({ job: name, status: 'ok', invocationId: 'inv-1' });
    },
  );
});
