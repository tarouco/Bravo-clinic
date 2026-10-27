import {
  deleteWithJustificationSchema,
  idSchema,
  localDateSchema,
  manualReceiptInputSchema,
} from '@bravo/core';
import { Hono } from 'hono';
import { z } from 'zod';
import { withTransaction } from '../../db/client';
import { actorContext } from '../../lib/request-meta';
import { validate } from '../../middleware/validate';
import { createReceipt, deleteReceipt, listReceipts } from '../../modules/finance/receipts.service';
import type { AppEnv } from '../../types';

const idParam = z.object({ id: idSchema });
const listQuery = z.object({
  from: localDateSchema.optional(),
  to: localDateSchema.optional(),
  cursor: z.string().min(1).max(200).optional(),
});

/** Recebimentos manuais (GES-20, GES-21); `adminRoutes` limits `/finance/*` to admins. */
export function adminFinanceReceiptRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/finance/receipts', validate('query', listQuery), async (c) =>
    c.json(await listReceipts(c.var.deps.db, c.req.valid('query'))),
  );

  app.post('/finance/receipts', validate('json', manualReceiptInputSchema), async (c) => {
    const ctx = actorContext(c);
    const receipt = await withTransaction(c.var.deps.db, (tx) =>
      createReceipt(tx, ctx, c.req.valid('json')),
    );
    return c.json(receipt, 201);
  });

  app.delete(
    '/finance/receipts/:id',
    validate('param', idParam),
    validate('json', deleteWithJustificationSchema),
    async (c) => {
      const { db, now } = c.var.deps;
      const ctx = actorContext(c);
      await withTransaction(db, (tx) =>
        deleteReceipt(tx, ctx, c.req.valid('param').id, c.req.valid('json').justification, now()),
      );
      return c.body(null, 204);
    },
  );
  return app;
}
