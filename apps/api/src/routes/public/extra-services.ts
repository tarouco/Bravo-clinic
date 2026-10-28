import { Hono } from 'hono';
import { listPublicExtraServices } from '../../modules/extras/extra-services.service';
import type { AppEnv } from '../../types';

/** `GET /public/extra-services` (GES-86): active services in display order. */
export function publicExtraServiceRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.get('/extra-services', async (c) => c.json(await listPublicExtraServices(c.var.deps.db)));
  return app;
}
