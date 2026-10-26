import {
  categoryCreateSchema,
  categoryReorderSchema,
  categoryUpdateSchema,
  idSchema,
} from '@bravo/core';
import { Hono } from 'hono';
import { z } from 'zod';
import { withTransaction } from '../../db/client';
import { actorContext } from '../../lib/request-meta';
import { requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import {
  createCategory,
  listCategories,
  markPricesReviewed,
  reorderCategories,
  setReference,
  updateCategory,
} from '../../modules/catalog/categories.service';
import type { AppEnv } from '../../types';

const idParam = z.object({ id: idSchema });

/** Category administration and the prices-reviewed checklist (NUC-61..NUC-69): admin only. */
export function adminCategoryRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const admin = requireRole('admin');

  app.get('/categories', admin, async (c) =>
    c.json({ items: await listCategories(c.var.deps.db, c.var.deps.registry) }),
  );

  app.post('/categories', admin, validate('json', categoryCreateSchema), async (c) => {
    const { db, registry } = c.var.deps;
    const ctx = actorContext(c);
    const created = await withTransaction(db, (tx) =>
      createCategory(tx, c.req.valid('json'), ctx, registry),
    );
    return c.json(created, 201);
  });

  // Declared before `/categories/:id` so that "reorder" is never read as an id.
  app.post('/categories/reorder', admin, validate('json', categoryReorderSchema), async (c) => {
    const { db, registry } = c.var.deps;
    const ctx = actorContext(c);
    const items = await withTransaction(db, (tx) =>
      reorderCategories(tx, c.req.valid('json').ids, ctx, registry),
    );
    return c.json({ items });
  });

  app.patch(
    '/categories/:id',
    admin,
    validate('param', idParam),
    validate('json', categoryUpdateSchema),
    async (c) => {
      const { db, registry } = c.var.deps;
      const ctx = actorContext(c);
      const { id } = c.req.valid('param');
      return c.json(
        await withTransaction(db, (tx) =>
          updateCategory(tx, id, c.req.valid('json'), ctx, registry),
        ),
      );
    },
  );

  app.post('/categories/:id/reference', admin, validate('param', idParam), async (c) => {
    const { db, registry } = c.var.deps;
    const ctx = actorContext(c);
    const { id } = c.req.valid('param');
    return c.json(await withTransaction(db, (tx) => setReference(tx, id, ctx, registry)));
  });

  app.post('/onboarding/prices-reviewed', admin, async (c) => {
    const ctx = actorContext(c);
    await withTransaction(c.var.deps.db, (tx) => markPricesReviewed(tx, ctx));
    return c.json({ pricesReviewed: true });
  });
  return app;
}
