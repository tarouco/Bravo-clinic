import {
  blockCreateSchema,
  blockRecurrenceCreateSchema,
  blocksQuerySchema,
  idSchema,
} from '@bravo/core';
import { Hono } from 'hono';
import { z } from 'zod';
import { withTransaction } from '../../db/client';
import { actorContext } from '../../lib/request-meta';
import { requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import {
  createBlocks,
  createRecurrence,
  deleteBlock,
  deleteRecurrence,
  listBlocks,
  listRecurrences,
} from '../../modules/calendar/blocks.service';
import type { AppEnv } from '../../types';

const idParam = z.object({ id: idSchema });

/** Manual blocks (staff) and weekly recurrences (admin only), NUC-54..NUC-58. */
export function adminBlockRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const admin = requireRole('admin');

  app.get('/blocks', validate('query', blocksQuerySchema), async (c) =>
    c.json({ items: await listBlocks(c.var.deps.db, c.req.valid('query')) }),
  );

  app.post('/blocks', validate('json', blockCreateSchema), async (c) => {
    const ctx = actorContext(c);
    const items = await withTransaction(c.var.deps.db, (tx) =>
      createBlocks(tx, c.req.valid('json'), ctx),
    );
    return c.json({ items }, 201);
  });

  app.delete('/blocks/:id', validate('param', idParam), async (c) => {
    const { db, now } = c.var.deps;
    const ctx = actorContext(c);
    const { id } = c.req.valid('param');
    await withTransaction(db, (tx) => deleteBlock(tx, id, ctx, now()));
    return c.body(null, 204);
  });

  app.get('/block-recurrences', admin, async (c) =>
    c.json({ items: await listRecurrences(c.var.deps.db) }),
  );

  app.post(
    '/block-recurrences',
    admin,
    validate('json', blockRecurrenceCreateSchema),
    async (c) => {
      const { db, now } = c.var.deps;
      const ctx = actorContext(c);
      const result = await withTransaction(db, (tx) =>
        createRecurrence(tx, c.req.valid('json'), ctx, now()),
      );
      return c.json(result, 201);
    },
  );

  app.delete('/block-recurrences/:id', admin, validate('param', idParam), async (c) => {
    const { db, now } = c.var.deps;
    const ctx = actorContext(c);
    const { id } = c.req.valid('param');
    await withTransaction(db, (tx) => deleteRecurrence(tx, id, ctx, now()));
    return c.body(null, 204);
  });
  return app;
}
