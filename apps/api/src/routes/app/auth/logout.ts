import { Hono } from 'hono';
import { clearSessionCookie } from '../../../auth/session';
import { logout } from '../../../modules/auth/login.service';
import type { AppEnv } from '../../../types';

/** `POST /app/auth/logout` (FND-55). */
export function logoutRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.post('/logout', async (c) => {
    await logout(c.var.deps.db, c.get('auth'));
    clearSessionCookie(c);
    return c.body(null, 204);
  });
  return app;
}
