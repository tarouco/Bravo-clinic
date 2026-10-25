import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../types';
import { requestContext } from './request-context';

afterEach(() => {
  vi.restoreAllMocks();
});

function buildApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('*', requestContext());
  app.get('/ping', (c) => c.json({ requestId: c.var.requestId }));
  app.get('/teapot', (c) => c.body(null, 418));
  app.get('/who', (c) => {
    c.set('userId', 'user-42');
    return c.json({ ok: true });
  });
  return app;
}

function captureLogLines(): () => Array<Record<string, unknown>> {
  const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  return () =>
    write.mock.calls.map((call) => JSON.parse(String(call[0])) as Record<string, unknown>);
}

describe('requestContext', () => {
  it('returns a generated X-Request-Id and exposes the same id to handlers', async () => {
    captureLogLines();

    const response = await buildApp().request('/ping');

    const header = response.headers.get('X-Request-Id');
    expect(header).toMatch(/^[0-9A-Z]{26}$/);
    expect(await response.json()).toEqual({ requestId: header });
  });

  it('echoes a valid inbound X-Request-Id', async () => {
    captureLogLines();

    const response = await buildApp().request('/ping', {
      headers: { 'X-Request-Id': 'abc-12345678' },
    });

    expect(response.headers.get('X-Request-Id')).toBe('abc-12345678');
    expect(await response.json()).toEqual({ requestId: 'abc-12345678' });
  });

  it('replaces an invalid inbound X-Request-Id', async () => {
    captureLogLines();

    const response = await buildApp().request('/ping', { headers: { 'X-Request-Id': 'x y' } });

    const header = response.headers.get('X-Request-Id');
    expect(header).not.toBe('x y');
    expect(header).toMatch(/^[0-9A-Z]{26}$/);
  });

  it('writes exactly one JSON log line per request with the documented fields', async () => {
    const lines = captureLogLines();

    const response = await buildApp().request('/teapot?token=abc', {
      headers: { 'X-Request-Id': 'req-00000001' },
    });

    expect(response.status).toBe(418);
    const [line, ...rest] = lines();
    expect(rest).toEqual([]);
    expect(line).toMatchObject({
      level: 'info',
      msg: 'request',
      requestId: 'req-00000001',
      method: 'GET',
      path: '/teapot',
      status: 418,
    });
    expect(line?.durationMs).toEqual(expect.any(Number));
    expect(line?.durationMs).toBeGreaterThanOrEqual(0);
    expect(line).not.toHaveProperty('userId');
  });

  it('logs the userId when a handler recorded one', async () => {
    const lines = captureLogLines();

    await buildApp().request('/who');

    expect(lines()[0]).toMatchObject({
      msg: 'request',
      path: '/who',
      status: 200,
      userId: 'user-42',
    });
  });
});
