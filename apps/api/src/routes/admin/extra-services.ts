import { extraServiceInputSchema, idSchema } from '@bravo/core';
import { Hono } from 'hono';
import { z } from 'zod';
import { withTransaction } from '../../db/client';
import { actorContext } from '../../lib/request-meta';
import { validate } from '../../middleware/validate';
import {
  createExtraService,
  listExtraServices,
  updateExtraService,
} from '../../modules/extras/extra-services.service';
import type { AppEnv } from '../../types';

const idParam = z.object({ id: idSchema });

/** Serviços extras catalog (GES-84, GES-85); `adminRoutes` limits it to admins. */
export function adminExtraServiceRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/extra-services', async (c) => c.json(await listExtraServices(c.var.deps.db)));

  app.post('/extra-services', validate('json', extraServiceInputSchema), async (c) => {
    const ctx = actorContext(c);
    const service = await withTransaction(c.var.deps.db, (tx) =>
      createExtraService(tx, ctx, c.req.valid('json')),
    );
    return c.json(service, 201);
  });

  app.patch(
    '/extra-services/:id',
    validate('param', idParam),
    validate('json', extraServiceInputSchema),
    async (c) => {
      const { db, now } = c.var.deps;
      const ctx = actorContext(c);
      const service = await withTransaction(db, (tx) =>
        updateExtraService(tx, ctx, c.req.valid('param').id, c.req.valid('json'), now()),
      );
      return c.json(service);
    },
  );
  return app;
}
