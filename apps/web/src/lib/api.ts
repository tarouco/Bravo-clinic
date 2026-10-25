// Fetch wrapper for the same-origin API (docs/architecture.md section 9.2). Every non-2xx response
// carries the error envelope of section 6.2 and becomes an `ApiError`.

export interface ApiErrorDetail {
  path: string;
  message: string;
}

interface ApiErrorInit {
  status: number;
  code: string;
  message: string;
  details?: ApiErrorDetail[];
  requestId?: string;
  retryAfterSeconds?: number;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: ApiErrorDetail[];
  readonly requestId: string | undefined;
  /** Seconds from the `Retry-After` header of a 429 response. */
  readonly retryAfterSeconds: number | undefined;

  constructor({ status, code, message, details = [], requestId, retryAfterSeconds }: ApiErrorInit) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export interface RequestOptions {
  idempotencyKey?: string;
  signal?: AbortSignal;
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface Envelope {
  error?: { code?: string; message?: string; details?: ApiErrorDetail[]; requestId?: string };
}

async function toApiError(response: Response): Promise<ApiError> {
  let envelope: Envelope = {};
  try {
    envelope = (await response.json()) as Envelope;
  } catch {
    // Not JSON (for example a gateway error page): fall back to a generic error.
  }
  const body = envelope.error;
  const retryAfter = Number(response.headers.get('Retry-After'));
  return new ApiError({
    status: response.status,
    code: body?.code ?? 'INTERNAL',
    message: body?.message ?? 'Erro inesperado. Tente novamente.',
    ...(body?.details ? { details: body.details } : {}),
    ...(body?.requestId ? { requestId: body.requestId } : {}),
    ...(retryAfter > 0 ? { retryAfterSeconds: retryAfter } : {}),
  });
}

async function request<T>(
  method: Method,
  path: string,
  body: unknown,
  options: RequestOptions = {},
): Promise<T> {
  const headers = new Headers({ Accept: 'application/json' });
  const init: RequestInit = { method, headers, credentials: 'same-origin' };

  // The API answers 415 to mutations without a JSON content type, so they always send a body.
  if (method !== 'GET') {
    headers.set('Content-Type', 'application/json');
    init.body = JSON.stringify(body ?? {});
  }
  if (options.idempotencyKey) headers.set('Idempotency-Key', options.idempotencyKey);
  if (options.signal) init.signal = options.signal;

  let response: Response;
  try {
    response = await fetch(path, init);
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiError({
      status: 0,
      code: 'NETWORK',
      message: 'Sem conexão com o servidor. Verifique sua internet e tente novamente.',
    });
  }

  if (!response.ok) throw await toApiError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** GET that returns the raw body (CSV export); non-2xx responses still become an `ApiError`. */
async function getBlob(path: string, options: RequestOptions = {}): Promise<Blob> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: 'GET',
      credentials: 'same-origin',
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch {
    throw new ApiError({
      status: 0,
      code: 'NETWORK',
      message: 'Sem conexão com o servidor. Verifique sua internet e tente novamente.',
    });
  }
  if (!response.ok) throw await toApiError(response);
  return response.blob();
}

export const api = {
  blob: getBlob,
  get: <T>(path: string, options?: RequestOptions) => request<T>('GET', path, undefined, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>('POST', path, body, options),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>('PUT', path, body, options),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>('PATCH', path, body, options),
  delete: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>('DELETE', path, body, options),
};
