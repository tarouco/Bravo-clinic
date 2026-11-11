import type { MiddlewareHandler } from 'hono';
import type { Env } from '../env';
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
 * `Referer` when `Origin` is absent) has to be the origin of `APP_BASE_URL` or of one of
 * `APP_EXTRA_ORIGINS`, the other hosts that serve the same site (e.g. the netlify.app address
 * next to the custom domain).
 */
export function csrf(
  env: Pick<Env, 'APP_BASE_URL' | 'APP_EXTRA_ORIGINS'>,
): MiddlewareHandler<AppEnv> {
  const allowed = new Set(
    [env.APP_BASE_URL, ...(env.APP_EXTRA_ORIGINS ?? [])].map((url) => new URL(url).origin),
  );
  return async (c, next) => {
    if (MUTATING.has(c.req.method)) {
      const origin = c.req.header('Origin');
      const referer = c.req.header('Referer');
      const source =
        origin !== undefined ? origin : referer !== undefined ? originOf(referer) : null;
      if (source === null || !allowed.has(source))
        throw forbidden('CSRF_REJECTED', 'Origem da requisição não permitida');
    }
    await next();
  };
}
