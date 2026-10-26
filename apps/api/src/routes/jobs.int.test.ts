import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { forbiddenFetch, testEnv } from '../../test/http';
import { requireTestDatabaseUrl } from '../../test/require-test-db';
import { createApp } from '../app';
import { createDb } from '../db/client';
import { jobRuns } from '../db/schema';
import { registerJob, runJob } from '../jobs';
import { createRegistry } from '../extensions/registry';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

const NOW = new Date('2026-10-20T12:00:00.000Z');

beforeEach(() => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

const buildApp = (verified = true) =>
  createApp({
    db,
    now: () => NOW,
    fetch: forbiddenFetch,
    env: testEnv(),
    verifyTrigger: verified
      ? () => Promise.resolve({ invocationId: 'inv-1' })
      : () => Promise.resolve(null),
  });

const post = (app: ReturnType<typeof buildApp>, name: string) =>
  app.request(`/jobs/${name}`, { method: 'POST', body: '{}' });

const deps = () => ({
  db,
  env: testEnv(),
  fetch: forbiddenFetch,
  now: () => NOW,
  registry: createRegistry(),
});

const runs = (job: string) =>
  db
    .select()
    .from(jobRuns)
    .orderBy(jobRuns.id)
    .then((rows) => rows.filter((row) => row.job === job));

describe('POST /jobs/:name (NUC-195)', () => {
  it('answers 401 to an unverified request and runs nothing', async () => {
    const res = await post(buildApp(false), 'expire-holds');

    expect(res.status).toBe(401);
    expect(await db.select().from(jobRuns)).toHaveLength(0);
  });

  it('refuses a request that only looks like a delivery: no header, or an id that does not match the body', async () => {
    const app = createApp({ db, now: () => NOW, fetch: forbiddenFetch, env: testEnv() });
    const body = JSON.stringify({
      version: 1,
      invocation_id: 'inv-9',
      trigger: { type: 'schedule', id: 'trg-1', name: 'expire-holds' },
      data: { scheduled_at: NOW.toISOString() },
    });

    const noHeader = await app.request('/jobs/expire-holds', { method: 'POST', body });
    const mismatch = await app.request('/jobs/expire-holds', {
      method: 'POST',
      body,
      headers: { 'x-neon-trigger-invocation-id': 'inv-other' },
    });
    const real = await app.request('/jobs/expire-holds', {
      method: 'POST',
      body,
      headers: { 'x-neon-trigger-invocation-id': 'inv-9' },
    });

    expect(noHeader.status).toBe(401);
    expect(mismatch.status).toBe(401);
    expect(real.status).toBe(200);
    expect((await runs('expire-holds'))[0]).toMatchObject({ invocationId: 'inv-9', status: 'ok' });
  });

  it('runs a verified job and records an ok row with the stats', async () => {
    const res = await post(buildApp(), 'expire-holds');

    expect(res.status).toBe(200);
    const body = (await res.json()) as { job: string; stats: Record<string, number> };
    expect(body.job).toBe('expire-holds');
    expect(body.stats).toMatchObject({ expiredBookings: 0, purgedIdempotencyKeys: 0 });
    const [row] = await runs('expire-holds');
    expect(row).toMatchObject({ status: 'ok', invocationId: 'inv-1' });
    expect(row?.stats).toEqual(body.stats);
    expect(row?.finishedAt).not.toBeNull();
  });

  it('records an error row when the job throws and answers 500', async () => {
    registerJob('boom-test', () => Promise.reject(new Error('banco indisponível')));

    const res = await post(buildApp(), 'boom-test');

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ job: 'boom-test', error: 'JOB_FAILED' });
    const [row] = await runs('boom-test');
    expect(row).toMatchObject({ status: 'error', error: 'banco indisponível' });
    expect(row?.finishedAt).not.toBeNull();
  });

  it('answers 404 to a verified request for an unknown job', async () => {
    const res = await post(buildApp(), 'does-not-exist');

    expect(res.status).toBe(404);
    expect(await db.select().from(jobRuns)).toHaveLength(0);
  });
});

describe('runJob (NUC-196)', () => {
  it('lets a concurrent second run of the same job return { skipped: true } at once', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const slow = async () => {
      calls += 1;
      await gate;
      return { done: true };
    };
    registerJob('slow-test', slow);

    const first = runJob('slow-test', slow, deps(), 'inv-a');
    await vi.waitFor(
      async () => {
        expect(await runs('slow-test')).toHaveLength(1);
      },
      { timeout: 15_000, interval: 100 },
    );
    const second = await runJob('slow-test', slow, deps(), 'inv-b');
    release();
    const firstStats = await first;

    expect(second).toEqual({ skipped: true });
    expect(firstStats).toEqual({ done: true });
    expect(calls).toBe(1);
    const rows = await runs('slow-test');
    expect(rows.map((r) => [r.invocationId, r.status, r.stats])).toEqual([
      ['inv-a', 'ok', { done: true }],
      ['inv-b', 'ok', { skipped: true }],
    ]);
  });
});
