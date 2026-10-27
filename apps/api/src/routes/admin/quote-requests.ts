import { idSchema, quoteStatusSchema, quoteStatusUpdateSchema } from '@bravo/core';
import { Hono } from 'hono';
import { z } from 'zod';
import { withTransaction } from '../../db/client';
import { actorContext } from '../../lib/request-meta';
import { validate } from '../../middleware/validate';
import { listQuoteRequests, updateQuoteRequest } from '../../modules/extras/quote-requests.service';
import type { AppEnv } from '../../types';

const idParam = z.object({ id: idSchema });
const listQuery = z.object({
  status: quoteStatusSchema.optional(),
  cursor: z.string().min(1).max(200).optional(),
});

/** The quote funnel (GES-95, GES-96); `adminRoutes` limits it to admins. */
export function adminQuoteRequestRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/quote-requests', validate('query', listQuery), async (c) =>
    c.json(await listQuoteRequests(c.var.deps.db, c.req.valid('query'))),
  );

  app.patch(
    '/quote-requests/:id',
    validate('param', idParam),
    validate('json', quoteStatusUpdateSchema),
    async (c) => {
      const { db, now } = c.var.deps;
      const ctx = actorContext(c);
      const updated = await withTransaction(db, (tx) =>
        updateQuoteRequest(tx, ctx, c.req.valid('param').id, c.req.valid('json'), now()),
      );
      return c.json(updated);
    },
  );
  return app;
}
