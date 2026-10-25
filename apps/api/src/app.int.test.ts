import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createApp } from './app';
import { conflict, tooManyRequests } from './lib/errors';
import { validate } from './middleware/validate';
import type { AppEnv } from './types';

afterEach(() => {
  vi.restoreAllMocks();
});

function silenceStdout() {
  return vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
}

const nameSchema = z.object({ name: z.string().min(2, 'Nome muito curto') });

function buildApp(): Hono<AppEnv> {
  const app = createApp();
  app.post('/test/validate', validate('json', nameSchema), (c) => c.json(c.req.valid('json')));
  app.get(
    '/test/query',
    validate('query', z.object({ page: z.coerce.number().int().min(1, 'Página inválida') })),
    (c) => c.json(c.req.valid('query')),
  );
  app.post(
    '/test/nested',
    validate(
      'json',
      z.object({ address: z.object({ zip: z.string().length(8, 'CEP inválido') }) }),
    ),
    (c) => c.json({ ok: true }),
  );
  app.get('/test/boom', () => {
    throw new Error('boom: SELECT * FROM users WHERE password_hash = $1');
  });
  app.get('/test/pg-exclusion', () => {
    throw Object.assign(new Error('conflicting key value violates exclusion constraint'), {
      code: '23P01',
    });
  });
  app.get('/test/pg-unique', () => {
    throw Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
    });
  });
  app.get('/test/pg-wrapped', () => {
    const cause = Object.assign(new Error('exclusion'), { code: '23P01' });
    throw new Error('Failed query: insert into room_occupancy', { cause });
  });
  app.get('/test/app-error', () => {
    throw conflict('EMAIL_TAKEN', 'E-mail já cadastrado');
  });
  app.get('/test/rate-limited', () => {
    throw tooManyRequests(90);
  });
  app.post('/test/echo', (c) => c.json({ ok: true }));
  app.post('/webhooks/x', (c) => c.text('hooked'));
  app.post('/jobs/x', (c) => c.text('job'));
  app.get('/test/deps', (c) => c.json({ now: c.var.deps.now().toISOString() }));
  return app;
}

function postJson(path: string, body: unknown, headers: Record<string, string> = {}) {
  return buildApp().request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('validation errors (FND-24)', () => {
  it('returns 422 with the documented envelope, field path and schema message', async () => {
    silenceStdout();

    const response = await postJson('/test/validate', { name: 'a' });

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Dados inválidos',
        details: [{ path: 'name', message: 'Nome muito curto' }],
        requestId: response.headers.get('X-Request-Id'),
      },
    });
  });

  it('joins nested paths with a dot', async () => {
    silenceStdout();

    const response = await postJson('/test/nested', { address: { zip: '123' } });

    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { details: unknown } };
    expect(body.error.details).toEqual([{ path: 'address.zip', message: 'CEP inválido' }]);
  });

  it('validates query parameters the same way', async () => {
    silenceStdout();

    const response = await buildApp().request('/test/query?page=0');

    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { code: string; details: unknown } };
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.details).toEqual([{ path: 'page', message: 'Página inválida' }]);
  });

  it('passes valid input through to the handler', async () => {
    silenceStdout();

    const response = await postJson('/test/validate', { name: 'Ana' });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ name: 'Ana' });
  });

  it('returns 400 BAD_REQUEST for a malformed JSON body', async () => {
    silenceStdout();

    const response = await buildApp().request('/test/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string; requestId: string } };
    expect(body.error.code).toBe('BAD_REQUEST');
    expect(body.error.requestId).toBe(response.headers.get('X-Request-Id'));
  });
});

describe('not found (FND-25)', () => {
  it('returns 404 NOT_FOUND for an unknown path', async () => {
    silenceStdout();

    const response = await buildApp().request('/nope');

    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { code: string; requestId: string } };
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.requestId).toBe(response.headers.get('X-Request-Id'));
  });
});

describe('unexpected errors (FND-26)', () => {
  it('returns 500 INTERNAL without stack or SQL and logs the stack with the requestId', async () => {
    const write = silenceStdout();

    const response = await buildApp().request('/test/boom');

    expect(response.status).toBe(500);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({
      error: {
        code: 'INTERNAL',
        message: 'Erro interno',
        requestId: response.headers.get('X-Request-Id'),
      },
    });
    expect(text).not.toContain('stack');
    expect(text).not.toContain('at ');
    expect(text).not.toContain('SELECT');

    const logged = write.mock.calls
      .map((call) => JSON.parse(String(call[0])) as Record<string, unknown>)
      .find((line) => line.level === 'error');
    expect(logged).toMatchObject({ requestId: response.headers.get('X-Request-Id') });
    expect(JSON.stringify(logged)).toContain('boom');
    expect(JSON.stringify(logged)).toContain('stack');
  });
});

describe('database errors', () => {
  it('maps SQLSTATE 23P01 to 409 SLOT_TAKEN', async () => {
    silenceStdout();

    const response = await buildApp().request('/test/pg-exclusion');

    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('SLOT_TAKEN');
  });

  it('maps SQLSTATE 23505 to 409 CONFLICT', async () => {
    silenceStdout();

    const response = await buildApp().request('/test/pg-unique');

    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('CONFLICT');
  });

  it('finds the SQLSTATE on the cause of a wrapped driver error', async () => {
    silenceStdout();

    const response = await buildApp().request('/test/pg-wrapped');

    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('SLOT_TAKEN');
  });
});

describe('AppError mapping', () => {
  it('uses the status, code and message of the thrown AppError', async () => {
    silenceStdout();

    const response = await buildApp().request('/test/app-error');

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        code: 'EMAIL_TAKEN',
        message: 'E-mail já cadastrado',
        requestId: response.headers.get('X-Request-Id'),
      },
    });
  });

  it('sends Retry-After with 429 TOO_MANY_ATTEMPTS', async () => {
    silenceStdout();

    const response = await buildApp().request('/test/rate-limited');

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('90');
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('TOO_MANY_ATTEMPTS');
  });
});

describe('JSON guard (FND-29)', () => {
  it('rejects a POST with text/plain with 415 UNSUPPORTED_MEDIA_TYPE', async () => {
    silenceStdout();

    const response = await buildApp().request('/test/echo', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'hello',
    });

    expect(response.status).toBe(415);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('rejects mutating requests without any content type, for every mutating verb', async () => {
    silenceStdout();
    const app = buildApp();

    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const response = await app.request('/test/echo', { method });
      expect(response.status, method).toBe(415);
    }
  });

  it('accepts application/json with a charset parameter and does not guard GET', async () => {
    silenceStdout();
    const app = buildApp();

    const post = await app.request('/test/echo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: '{}',
    });
    const get = await app.request('/test/deps');

    expect(post.status).toBe(200);
    expect(get.status).toBe(200);
  });

  it('does not reject non-JSON posts to /webhooks/* and /jobs/*', async () => {
    silenceStdout();
    const app = buildApp();
    const init = { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'raw' };

    const webhook = await app.request('/webhooks/x', init);
    const job = await app.request('/jobs/x', init);

    expect(webhook.status).toBe(200);
    expect(await webhook.text()).toBe('hooked');
    expect(job.status).toBe(200);
  });
});

describe('createApp', () => {
  it('makes injected dependencies available to handlers', async () => {
    silenceStdout();
    const app = createApp({ now: () => new Date('2026-10-27T13:00:00.000Z') });
    app.get('/test/deps', (c) => c.json({ now: c.var.deps.now().toISOString() }));

    const response = await app.request('/test/deps');

    expect(await response.json()).toEqual({ now: '2026-10-27T13:00:00.000Z' });
  });
});
