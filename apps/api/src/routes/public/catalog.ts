import { roomSlugSchema } from '@bravo/core';
import { Hono } from 'hono';
import { z } from 'zod';
import { validate } from '../../middleware/validate';
import {
  getCatalog,
  getClinic,
  getPublicPolicies,
  getRoomDetail,
  listRooms,
} from '../../modules/catalog/catalog.service';
import type { AppEnv } from '../../types';

/** `GET /public/rooms`, `/rooms/:slug`, `/catalog`, `/clinic`, `/policies` (NUC-74..NUC-76, NUC-84, NUC-85). */
export function catalogRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.get('/rooms', async (c) => {
    const { db, registry } = c.var.deps;
    return c.json(await listRooms(db, registry));
  });
  app.get('/rooms/:slug', validate('param', z.object({ slug: roomSlugSchema })), async (c) => {
    const { db, registry } = c.var.deps;
    return c.json(await getRoomDetail(db, c.req.valid('param').slug, registry));
  });
  app.get('/catalog', async (c) => c.json(await getCatalog(c.var.deps.db)));
  app.get('/clinic', async (c) => c.json(await getClinic(c.var.deps.db)));
  app.get('/policies', async (c) => c.json(await getPublicPolicies(c.var.deps.db)));
  return app;
}
