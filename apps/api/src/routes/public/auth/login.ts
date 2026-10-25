import { loginSchema } from '@bravo/core';
import { Hono } from 'hono';
import { setSessionCookie } from '../../../auth/session';
import { requestMeta } from '../../../lib/request-meta';
import { validate } from '../../../middleware/validate';
import { login } from '../../../modules/auth/login.service';
import type { AppEnv } from '../../../types';

/** `POST /public/auth/login` (FND-52..54, FND-66 login half). */
export function loginRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.post('/login', validate('json', loginSchema), async (c) => {
    const result = await login(c.var.deps, c.req.valid('json'), requestMeta(c));
    setSessionCookie(c, result.session.token, result.session.maxAgeSeconds);
    return c.json({ user: result.user, mfaRequired: result.mfaRequired });
  });
  return app;
}
