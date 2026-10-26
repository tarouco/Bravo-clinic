import { updateMeSchema } from '@bravo/core';
import { Hono } from 'hono';
import { validate } from '../../middleware/validate';
import { getMe } from '../../modules/auth/login.service';
import { updateProfile } from '../../modules/auth/profile.service';
import type { AppEnv } from '../../types';

/** `GET /app/me` (FND-57) and `PATCH /app/me` (NUC-192). */
export function meRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.get('/me', async (c) => c.json(await getMe(c.var.deps.db, c.get('auth'))));
  app.patch('/me', validate('json', updateMeSchema), async (c) =>
    c.json(await updateProfile(c.var.deps.db, c.get('auth'), c.req.valid('json'))),
  );
  return app;
}
