import { Hono } from 'hono';
import { getMe } from '../../modules/auth/login.service';
import type { AppEnv } from '../../types';

/** `GET /app/me` (FND-57). */
export function meRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.get('/me', async (c) => c.json(await getMe(c.var.deps.db, c.get('auth'))));
  return app;
}
