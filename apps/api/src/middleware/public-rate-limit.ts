import type { MiddlewareHandler } from 'hono';
import { tooManyRequests } from '../lib/errors';
import { clientIp } from '../lib/request-meta';
import type { AppEnv } from '../types';
import { consumeRateLimit, rateLimitKey } from './rate-limit';

const LIMIT_PER_MINUTE = 120;

/**
 * 120 requests per minute per IP on the public availability and quote endpoints (NUC-81); one
 * shared bucket so a client cannot double its budget by alternating endpoints.
 */
export function publicCalendarRateLimit(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const { db, now } = c.var.deps;
    const result = await consumeRateLimit(
      db,
      rateLimitKey('public-calendar', clientIp(c) ?? 'unknown'),
      { limit: LIMIT_PER_MINUTE, windowSeconds: 60, now: now() },
    );
    if (!result.allowed) throw tooManyRequests(result.retryAfterSeconds);
    await next();
  };
}
