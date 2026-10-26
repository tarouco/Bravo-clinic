import { idSchema, saveCardSchema } from '@bravo/core';
import { Hono } from 'hono';
import { z } from 'zod';
import { requestMeta } from '../../lib/request-meta';
import { rejectCardData } from '../../middleware/reject-card-data';
import { validate } from '../../middleware/validate';
import {
  deleteCard,
  listSavedCards,
  saveCard,
  toSavedCard,
} from '../../modules/payments/cards.service';
import type { AppEnv } from '../../types';

const idParam = z.object({ id: idSchema });

/** Saved cards of the signed-in tenant (NUC-126, NUC-127, NUC-128). */
export function cardRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/cards', async (c) => {
    const rows = await listSavedCards(c.var.deps.db, c.get('auth').userId);
    return c.json({ items: rows.map(toSavedCard) });
  });

  app.post('/cards', rejectCardData(), validate('json', saveCardSchema), async (c) => {
    const card = await saveCard(
      c.var.deps,
      requestMeta(c),
      c.get('auth').userId,
      c.req.valid('json').cardToken,
    );
    return c.json(card, 201);
  });

  app.delete('/cards/:id', validate('param', idParam), async (c) => {
    const { db, now } = c.var.deps;
    await deleteCard(db, c.get('auth').userId, c.req.valid('param').id, now());
    return c.body(null, 204);
  });

  return app;
}
