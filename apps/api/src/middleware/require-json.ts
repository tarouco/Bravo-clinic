import type { MiddlewareHandler } from 'hono';
import { AppError } from '../lib/errors';
import type { AppEnv } from '../types';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
// Webhooks and jobs carry provider-defined bodies and validate them on their own.
const EXEMPT_PREFIXES = ['/webhooks/', '/jobs/'];

export function requireJson(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (MUTATING.has(c.req.method) && !EXEMPT_PREFIXES.some((p) => c.req.path.startsWith(p))) {
      const mediaType = c.req.header('Content-Type')?.split(';')[0]?.trim().toLowerCase();
      if (mediaType !== 'application/json') {
        throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type deve ser application/json');
      }
    }
    await next();
  };
}
