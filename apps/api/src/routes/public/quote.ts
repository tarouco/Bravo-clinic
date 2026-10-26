import { quoteRequestSchema } from '@bravo/core';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { resolveSession, SESSION_COOKIE } from '../../auth/session';
import { users } from '../../db/schema';
import { publicCalendarRateLimit } from '../../middleware/public-rate-limit';
import { validate } from '../../middleware/validate';
import { buildQuote } from '../../modules/booking/quote.service';
import type { AppEnv } from '../../types';

/** `POST /public/bookings/quote` (NUC-86..NUC-88): public, with the session read when present. */
export function quoteRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.post(
    '/bookings/quote',
    publicCalendarRateLimit(),
    validate('json', quoteRequestSchema),
    async (c) => {
      const { db, env, now, registry } = c.var.deps;
      const token = getCookie(c, SESSION_COOKIE);
      const auth =
        token === undefined ? null : await resolveSession(db, token, env.SESSION_SECRET, now());
      const [row] =
        auth === null
          ? []
          : await db
              .select({ id: users.id, docNumber: users.docNumber })
              .from(users)
              .where(eq(users.id, auth.userId));
      const result = await buildQuote(db, c.req.valid('json'), {
        now: now(),
        user: row === undefined ? null : { id: row.id, docNumber: row.docNumber },
        registry,
      });
      if (!result.ok) throw result.error;
      return c.json(result.quote);
    },
  );
  return app;
}
