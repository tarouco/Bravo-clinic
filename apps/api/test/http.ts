import type { Hono } from 'hono';
import { parseEnv, type Env } from '../src/env';
import type { AppEnv } from '../src/types';

/** Origin the CSRF check accepts (APP_BASE_URL of the test environment). */
export const APP_ORIGIN = 'http://localhost:5173';

/** Env of the app under test: no e-mail provider and no Google unless a test adds them. */
export function testEnv(extra: Record<string, string | undefined> = {}): Env {
  return parseEnv({
    ...process.env,
    RESEND_API_KEY: undefined,
    GOOGLE_CLIENT_ID: undefined,
    GOOGLE_CLIENT_SECRET: undefined,
    NEON_BRANCH: undefined,
    ...extra,
  });
}

/** `fetch` for tests that must never reach the network. */
export const forbiddenFetch: typeof fetch = () =>
  Promise.reject(new Error('unexpected network call'));

export interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: { path: string; message: string }[];
    requestId: string;
  };
}

export interface SendOptions {
  body?: unknown;
  /** Value of the `Cookie` request header. */
  cookie?: string;
  headers?: Record<string, string>;
}

export interface Sent {
  status: number;
  headers: Headers;
  /** Parsed JSON body, or null when the response has none. */
  body: unknown;
  /** The body typed as an error envelope, for assertions on `error.code`. */
  error: ErrorBody['error'] | undefined;
}

/** Sends a JSON request that passes the JSON guard and the CSRF origin check. */
export async function send(
  app: Hono<AppEnv>,
  method: string,
  path: string,
  options: SendOptions = {},
): Promise<Sent> {
  const response = await app.request(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Origin: APP_ORIGIN,
      ...(options.cookie !== undefined && { Cookie: options.cookie }),
      ...options.headers,
    },
    ...(options.body !== undefined && { body: JSON.stringify(options.body) }),
  });
  const text = await response.text();
  const body: unknown = text === '' ? null : JSON.parse(text);
  return {
    status: response.status,
    headers: response.headers,
    body,
    error: (body as Partial<ErrorBody> | null)?.error,
  };
}

/** The `Cookie` request header value for the session cookie a response set, if any. */
export function sessionCookieFrom(headers: Headers): string | undefined {
  const setCookie = headers.getSetCookie().find((value) => value.startsWith('bravo_session='));
  return setCookie?.split(';')[0];
}
