import { Hono } from 'hono';
import { usageReport } from '../../modules/usage/usage.service';
import type { AppEnv } from '../../types';

/** `GET /admin/usage` (GES-137..GES-139); `adminRoutes` limits it to admins. */
export function adminUsageRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.get('/usage', async (c) => {
    const { db, storage, now } = c.var.deps;
    return c.json(await usageReport({ db, storage }, now()));
  });
  return app;
}
