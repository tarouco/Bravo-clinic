import type { MiddlewareHandler } from 'hono';
import { forbidden } from '../lib/errors';
import type { AppEnv } from '../types';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function originOf(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * Cookie-authenticated mutations must come from the app itself: `Origin` (or the origin of
 * `Referer` when `Origin` is absent) has to equal the origin of `APP_BASE_URL`.
 */
export function csrf(appBaseUrl: string): MiddlewareHandler<AppEnv> {
  const allowed = new URL(appBaseUrl).origin;
  return async (c, next) => {
    if (MUTATING.has(c.req.method)) {
      const origin = c.req.header('Origin');
      const referer = c.req.header('Referer');
      const source =
        origin !== undefined ? origin : referer !== undefined ? originOf(referer) : null;
      if (source !== allowed)
        throw forbidden('CSRF_REJECTED', 'Origem da requisição não permitida');
    }
    await next();
  };
}
