import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createUser, loginAs } from '../../test/factories';
import { testEnv } from '../../test/http';
import { requireTestDatabaseUrl } from '../../test/require-test-db';
import { createApp } from '../app';
import { createDb } from '../db/client';
import type { Env } from '../env';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));
// APP_BASE_URL of the test environment (vitest.config.ts).
const APP_ORIGIN = 'http://localhost:5173';

afterAll(async () => {
  await pool.end();
});

beforeEach(() => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

function buildApp(env?: Env) {
  const app = createApp({ db, ...(env !== undefined && { env }) });
  app.on(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], '/app/x', (c) => c.json({ ok: true }));
  app.on(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], '/admin/x', (c) => c.json({ ok: true }));
  app.post('/public/x', (c) => c.json({ ok: true }));
  return app;
}

async function send(
  method: string,
  path: string,
  headers: Record<string, string>,
  cookie?: string,
  env?: Env,
) {
  const response = await buildApp(env).request(path, {
    method,
    headers: {
      ...(method === 'GET' ? {} : { 'Content-Type': 'application/json' }),
      ...(cookie === undefined ? {} : { Cookie: cookie }),
      ...headers,
    },
    ...(method === 'GET' ? {} : { body: '{}' }),
  });
  const body = (await response.json()) as { error?: { code: string } };
  return { status: response.status, code: body.error?.code };
}

describe('csrf origin check (FND-59)', () => {
  it('rejects a POST to /app/x from a foreign Origin with 403 CSRF_REJECTED', async () => {
    const cookie = await loginAs(db, await createUser(db));

    const result = await send('POST', '/app/x', { Origin: 'https://evil.example' }, cookie);

    expect(result).toEqual({ status: 403, code: 'CSRF_REJECTED' });
  });

  it('lets a POST with the app Origin reach the next handler', async () => {
    const cookie = await loginAs(db, await createUser(db));

    const result = await send('POST', '/app/x', { Origin: APP_ORIGIN }, cookie);

    expect(result.status).toBe(200);
  });

  it('uses the Referer origin when Origin is absent', async () => {
    const cookie = await loginAs(db, await createUser(db));

    const matching = await send('POST', '/app/x', { Referer: `${APP_ORIGIN}/app/perfil` }, cookie);
    const foreign = await send('POST', '/app/x', { Referer: 'https://evil.example/app' }, cookie);

    expect(matching.status).toBe(200);
    expect(foreign).toEqual({ status: 403, code: 'CSRF_REJECTED' });
  });

  it('rejects a mutation that carries neither Origin nor Referer', async () => {
    const cookie = await loginAs(db, await createUser(db));

    const result = await send('POST', '/app/x', {}, cookie);

    expect(result).toEqual({ status: 403, code: 'CSRF_REJECTED' });
  });

  it('checks every mutating verb under /admin/* too, before authentication', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const result = await send(method, '/admin/x', { Origin: 'https://evil.example' });
      expect(result, method).toEqual({ status: 403, code: 'CSRF_REJECTED' });
    }
  });

  it('does not block a GET with a foreign Origin', async () => {
    const cookie = await loginAs(db, await createUser(db));

    const result = await send('GET', '/app/x', { Origin: 'https://evil.example' }, cookie);

    expect(result.status).toBe(200);
  });

  it('does not check POST /public/x', async () => {
    const result = await send('POST', '/public/x', { Origin: 'https://evil.example' });

    expect(result.status).toBe(200);
  });
});

// The site answers on its custom domain and on the netlify.app address; both send mutations.
describe('csrf with APP_EXTRA_ORIGINS', () => {
  const CANONICAL = 'https://www.bravo.example';
  const SECONDARY = 'https://bravo.netlify.example';
  const env = () =>
    testEnv({ APP_BASE_URL: CANONICAL, APP_EXTRA_ORIGINS: `${SECONDARY}/, https://third.example` });

  it('accepts the APP_BASE_URL origin and every extra origin', async () => {
    const cookie = await loginAs(db, await createUser(db));

    for (const origin of [CANONICAL, SECONDARY, 'https://third.example']) {
      const result = await send('POST', '/app/x', { Origin: origin }, cookie, env());
      expect(result.status, origin).toBe(200);
    }
  });

  it('accepts an extra origin through Referer when Origin is absent', async () => {
    const cookie = await loginAs(db, await createUser(db));

    const result = await send(
      'POST',
      '/app/x',
      { Referer: `${SECONDARY}/reservar` },
      cookie,
      env(),
    );

    expect(result.status).toBe(200);
  });

  it('still rejects origins outside the list, including look-alikes of a listed host', async () => {
    const cookie = await loginAs(db, await createUser(db));

    for (const origin of [
      'https://evil.example',
      'https://bravo.example',
      'http://www.bravo.example',
      'https://www.bravo.example.evil.example',
      'https://www.bravo.example:8443',
      'null',
    ]) {
      const result = await send('POST', '/app/x', { Origin: origin }, cookie, env());
      expect(result, origin).toEqual({ status: 403, code: 'CSRF_REJECTED' });
    }
  });

  it('accepts only the APP_BASE_URL origin when no extra origin is configured', async () => {
    const cookie = await loginAs(db, await createUser(db));
    const single = testEnv({ APP_BASE_URL: CANONICAL });

    const canonical = await send('POST', '/app/x', { Origin: CANONICAL }, cookie, single);
    const secondary = await send('POST', '/app/x', { Origin: SECONDARY }, cookie, single);

    expect(canonical.status).toBe(200);
    expect(secondary).toEqual({ status: 403, code: 'CSRF_REJECTED' });
  });
});
