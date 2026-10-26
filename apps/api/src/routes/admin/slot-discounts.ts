import { idSchema, localDateSchema, slotDiscountInput } from '@bravo/core';
import { Hono } from 'hono';
import { z } from 'zod';
import { withTransaction } from '../../db/client';
import { actorContext } from '../../lib/request-meta';
import { requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import {
  applyDiscount,
  listDiscounts,
  removeDiscount,
} from '../../modules/slot-discounts/slot-discounts.service';
import type { AppEnv } from '../../types';

const idParam = z.object({ id: idSchema });
const listQuery = z
  .object({ from: localDateSchema, to: localDateSchema, roomId: idSchema.optional() })
  .refine((q) => q.from <= q.to, { error: 'O fim precisa ser depois do início', path: ['to'] });

/** Slot discounts (REC-133..REC-141): staff read them; only the admin creates or removes. */
export function adminSlotDiscountRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const admin = requireRole('admin');

  app.get('/slot-discounts', validate('query', listQuery), async (c) => {
    const { db, now } = c.var.deps;
    const { from, to, roomId } = c.req.valid('query');
    const items = await listDiscounts(db, {
      from,
      to,
      ...(roomId !== undefined && { roomId }),
      now: now(),
    });
    return c.json({ items });
  });

  app.post('/slot-discounts', admin, validate('json', slotDiscountInput), async (c) => {
    const { db, now } = c.var.deps;
    const ctx = actorContext(c);
    const result = await withTransaction(db, (tx) =>
      applyDiscount(tx, ctx, c.req.valid('json'), now()),
    );
    return c.json(result, 201);
  });

  app.delete('/slot-discounts/:id', admin, validate('param', idParam), async (c) => {
    const { db, now } = c.var.deps;
    const ctx = actorContext(c);
    await withTransaction(db, (tx) => removeDiscount(tx, ctx, c.req.valid('param').id, now()));
    return c.body(null, 204);
  });

  return app;
}
