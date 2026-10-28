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

  it('keeps the object details of a 409 envelope (SLOT_TAKEN, AFFECTED_BOOKINGS, ...)', async () => {
    const envelope = {
      error: {
        code: 'BLOCK_CONFLICT',
        message: 'Conflito',
        details: { dates: ['2026-10-27'], reason: 'occupied' },
      },
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(409, envelope)));

    const error = await api.post('/x', {}).catch((e: unknown) => e);

    expect((error as ApiError).details).toEqual({ dates: ['2026-10-27'], reason: 'occupied' });
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

  it('exposes the Retry-After header of a 429 response as retryAfterSeconds', async () => {
    const response = new Response(
      JSON.stringify({ error: { code: 'TOO_MANY_ATTEMPTS', message: 'Muitas tentativas' } }),
      { status: 429, headers: { 'Retry-After': '720' } },
    );
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));

    const error = (await api.post('/x', {}).catch((e: unknown) => e)) as ApiError;

    expect(error.status).toBe(429);
    expect(error.retryAfterSeconds).toBe(720);
  });

  it('maps a non-envelope error body to ApiError with code INTERNAL and the HTTP status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 502 })));

    const error = (await api.get('/x').catch((e: unknown) => e)) as ApiError;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(502);
    expect(error.code).toBe('INTERNAL');
  });
});

describe('early response of index.html (GES-143)', () => {
  afterEach(() => {
    delete window.__bravoEarly;
  });

  it('answers the first GET of the same path from the early response, then fetches again', async () => {
    window.__bravoEarly = {
      path: '/api/public/rooms',
      response: Promise.resolve(jsonResponse(200, { items: ['early'] })),
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { items: ['fetched'] }));
    vi.stubGlobal('fetch', fetchMock);

    expect(await api.get('/api/public/rooms')).toEqual({ items: ['early'] });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await api.get('/api/public/rooms')).toEqual({ items: ['fetched'] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('turns an early error response into the same ApiError', async () => {
    window.__bravoEarly = {
      path: '/api/public/rooms/nope',
      response: Promise.resolve(
        jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'Recurso não encontrado' } }),
      ),
    };
    vi.stubGlobal('fetch', vi.fn());

    const error = (await api.get('/api/public/rooms/nope').catch((e: unknown) => e)) as ApiError;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(404);
    expect(error.code).toBe('NOT_FOUND');
  });

  it('ignores an early response of another path and fetches after a failed early request', async () => {
    // The inline script also handles its own rejection, so none goes unhandled.
    const failed = Promise.reject(new TypeError('offline'));
    failed.catch(() => undefined);
    window.__bravoEarly = { path: '/api/public/rooms/principal', response: failed };
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(jsonResponse(200, { ok: true })));
    vi.stubGlobal('fetch', fetchMock);

    expect(await api.get('/api/public/catalog')).toEqual({ ok: true });
    expect(await api.get('/api/public/rooms/principal')).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('api.upload', () => {
  it('PUTs the file itself with its own media type and same-origin credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { id: 'e1' }));
    vi.stubGlobal('fetch', fetchMock);
    const file = new File(['%PDF-1.4'], 'nota.pdf', { type: 'application/pdf' });

    const result = await api.upload<{ id: string }>('/x/attachment', file);

    expect(result).toEqual({ id: 'e1' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/x/attachment');
    expect(init.method).toBe('PUT');
    expect(init.credentials).toBe('same-origin');
    expect(init.body).toBe(file);
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/pdf');
  });

  it('sends the URI-encoded name of a File in X-File-Name, and none for a bare Blob', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await api.upload('/x', new File(['x'], 'nota fiscal ç.pdf', { type: 'application/pdf' }));
    await api.upload('/y', new Blob(['x'], { type: 'image/webp' }));

    const headersOf = (call: number) =>
      new Headers((fetchMock.mock.calls[call] as [string, RequestInit])[1].headers);
    expect(headersOf(0).get('X-File-Name')).toBe('nota%20fiscal%20%C3%A7.pdf');
    expect(headersOf(1).has('X-File-Name')).toBe(false);
  });

  it('answers undefined for a 204 and throws the ApiError of a 413', async () => {
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(null, { status: 204 })));
    expect(await api.upload('/x', file)).toBeUndefined();

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(413, {
          error: { code: 'PAYLOAD_TOO_LARGE', message: 'Arquivo maior que 5 MB' },
        }),
      ),
    );
    const error = (await api.upload('/x', file).catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(413);
    expect(error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('maps a rejected fetch to the NETWORK error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    const error = (await api.upload('/x', new Blob(['x'])).catch((e: unknown) => e)) as ApiError;

    expect(error.code).toBe('NETWORK');
  });
});
