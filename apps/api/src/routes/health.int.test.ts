import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app';
import { createDb, type Db } from '../db/client';
import { parseEnv } from '../env';
import { requireTestDatabaseUrl } from '../../test/require-test-db';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

beforeEach(() => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const envWith = (neonBranch: string | undefined) =>
  parseEnv({ ...process.env, NEON_BRANCH: neonBranch });

function failingDb(execute: () => Promise<never>): Db {
  return { execute } as unknown as Db;
}

describe('GET /health', () => {
  it('returns 200 ok with branch null when the database answers (FND-21)', async () => {
    const app = createApp({ db, env: envWith(undefined) });

    const response = await app.request('/health');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', db: 'ok', branch: null });
  });

  it('reports the NEON_BRANCH when it is set (FND-21)', async () => {
    const app = createApp({ db, env: envWith('dev') });

    const response = await app.request('/health');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', db: 'ok', branch: 'dev' });
  });

  it('returns 503 degraded when the database query fails (FND-22)', async () => {
    const app = createApp({
      db: failingDb(() => Promise.reject(new Error('connection refused'))),
      env: envWith('dev'),
    });

    const response = await app.request('/health');

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: 'degraded', db: 'error' });
  });

  it('waits up to 10 seconds for a cold database before degrading', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const app = createApp({
      db: failingDb(() => new Promise<never>(() => undefined)),
      env: envWith(undefined),
    });

    let settled = false;
    const pending = Promise.resolve(app.request('/health')).then((response) => {
      settled = true;
      return response;
    });
    await vi.advanceTimersByTimeAsync(9_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const response = await pending;

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: 'degraded', db: 'error' });
  });
});
