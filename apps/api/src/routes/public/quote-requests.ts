import { quoteRequestInputSchema, utcToLocal } from '@bravo/core';
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { resolveSession, SESSION_COOKIE } from '../../auth/session';
import { badRequest, tooManyRequests, validationFailed } from '../../lib/errors';
import { auditContext, clientIp, requestMeta } from '../../lib/request-meta';
import { consumeRateLimit, rateLimitKey } from '../../middleware/rate-limit';
import { createQuoteRequest } from '../../modules/extras/quote-requests.service';
import type { AppEnv } from '../../types';

/** Requests per IP per hour (GES-92). */
const LIMIT_PER_HOUR = 5;

/**
 * `POST /public/quote-requests` (GES-90..GES-94): public, linked to the session user when there is
 * one. Every attempt counts toward the IP limit; a filled honeypot answers 202 and stores nothing.
 */
export function publicQuoteRequestRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.post('/quote-requests', async (c) => {
    const deps = c.var.deps;
    const now = deps.now();
    const limit = await consumeRateLimit(
      deps.db,
      rateLimitKey('quote-request', clientIp(c) ?? 'unknown'),
      { limit: LIMIT_PER_HOUR, windowSeconds: 3600, now },
    );
    if (!limit.allowed) throw tooManyRequests(limit.retryAfterSeconds);

    const raw: unknown = await c.req.json().catch(() => {
      throw badRequest();
    });
    const website = (raw as { website?: unknown } | null)?.website;
    if (typeof website === 'string' && website.trim() !== '') return c.json({}, 202);

    const parsed = quoteRequestInputSchema(utcToLocal(now).date).safeParse(raw);
    if (!parsed.success) throw validationFailed(parsed.error.issues);

    const token = getCookie(c, SESSION_COOKIE);
    const auth =
      token === undefined
        ? null
        : await resolveSession(deps.db, token, deps.env.SESSION_SECRET, now);
    const ctx = auditContext(
      requestMeta(c),
      auth === null ? null : { id: auth.userId, role: auth.role },
    );
    const created = await createQuoteRequest(deps, ctx, parsed.data, auth?.userId ?? null);
    return c.json(created, 201);
  });
  return app;
}
