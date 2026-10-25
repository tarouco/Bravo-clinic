import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createUser, loginAs } from '../../test/factories';
import { requireTestDatabaseUrl } from '../../test/require-test-db';
import { createApp } from '../app';
import { createDb } from '../db/client';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));
// APP_BASE_URL of the test environment (vitest.config.ts).
const APP_ORIGIN = 'http://localhost:5173';

afterAll(async () => {
  await pool.end();
});

beforeEach(() => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

function buildApp() {
  const app = createApp({ db });
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
) {
  const response = await buildApp().request(path, {
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
