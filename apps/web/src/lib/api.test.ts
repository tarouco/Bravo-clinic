import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from './api';

function jsonResponse(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('api client', () => {
  it('POST sends a JSON body with same-origin credentials and the JSON content type', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await api.post<{ ok: boolean }>('/x', { a: 1 });

    expect(result).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/x');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('same-origin');
    expect(init.body).toBe(JSON.stringify({ a: 1 }));
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
  });

  it('throws ApiError with status, code, message, details and requestId from a 422 envelope', async () => {
    const envelope = {
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Dados inválidos',
        details: [{ path: 'document', message: 'CPF ou CNPJ inválido' }],
        requestId: '01JREQ',
      },
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(422, envelope)));

    const error = await api.post('/x', {}).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(422);
    expect(apiError.code).toBe('VALIDATION_FAILED');
    expect(apiError.message).toBe('Dados inválidos');
    expect(apiError.details).toEqual([{ path: 'document', message: 'CPF ou CNPJ inválido' }]);
    expect(apiError.requestId).toBe('01JREQ');
  });

  it('throws ApiError with code NETWORK when fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    const error = await api.get('/x').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('NETWORK');
    expect((error as ApiError).status).toBe(0);
  });

  it('sends the Idempotency-Key header when the option is given and omits it otherwise', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(200, {})));
    vi.stubGlobal('fetch', fetchMock);

    await api.post('/x', {}, { idempotencyKey: 'key-123' });
    await api.post('/x', {});

    const first = new Headers((fetchMock.mock.calls[0] as [string, RequestInit])[1].headers);
    const second = new Headers((fetchMock.mock.calls[1] as [string, RequestInit])[1].headers);
    expect(first.get('Idempotency-Key')).toBe('key-123');
    expect(second.has('Idempotency-Key')).toBe(false);
  });

  it('GET sends no body and returns undefined for a 204 response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await api.get('/x');

    expect(result).toBeUndefined();
    const init = (fetchMock.mock.calls[0] as [string, RequestInit])[1];
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
  });

  it('maps a non-envelope error body to ApiError with code INTERNAL and the HTTP status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 502 })));

    const error = (await api.get('/x').catch((e: unknown) => e)) as ApiError;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(502);
    expect(error.code).toBe('INTERNAL');
  });
});
