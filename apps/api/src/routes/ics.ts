import { Hono } from 'hono';
import { notFound, tooManyRequests } from '../lib/errors';
import { consumeRateLimit } from '../middleware/rate-limit';
import {
  FEED_RATE_LIMIT,
  FEED_RATE_WINDOW_SECONDS,
  feedRateLimitKey,
  findFeedByToken,
  renderFeed,
  touchFeed,
} from '../modules/ics/ics-feed.service';
import type { AppEnv } from '../types';

/**
 * `GET /ics/<token>.ics` (public, GES-44..GES-52). Unknown, revoked and malformed tokens get the
 * same 404; a known token is limited to 60 fetches per hour.
 */
export function icsRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.get('/:file', async (c) => {
    const { db, now } = c.var.deps;
    const file = c.req.param('file');
    const token = file.endsWith('.ics') ? file.slice(0, -'.ics'.length) : '';
    const feed = await findFeedByToken(db, token);
    if (feed === null) throw notFound();
    const at = now();
    const limit = await consumeRateLimit(db, feedRateLimitKey(feed.id), {
      limit: FEED_RATE_LIMIT,
      windowSeconds: FEED_RATE_WINDOW_SECONDS,
      now: at,
    });
    if (!limit.allowed) throw tooManyRequests(limit.retryAfterSeconds);
    const body = await renderFeed(db, feed, at);
    await touchFeed(db, feed.id, at);
    return c.body(body, 200, {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Cache-Control': 'private, max-age=300',
    });
  });
  return app;
}
