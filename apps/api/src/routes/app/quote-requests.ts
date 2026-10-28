import { Hono } from 'hono';
import { z } from 'zod';
import { validate } from '../../middleware/validate';
import { listOwnQuoteRequests } from '../../modules/extras/quote-requests.service';
import type { AppEnv } from '../../types';

const listQuery = z.object({ cursor: z.string().min(1).max(200).optional() });

/** `GET /app/quote-requests` (GES-97): the session user's own requests, newest first. */
export function appQuoteRequestRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.get('/quote-requests', validate('query', listQuery), async (c) =>
    c.json(
      await listOwnQuoteRequests(c.var.deps.db, c.get('auth').userId, c.req.valid('query').cursor),
    ),
  );
  return app;
}
