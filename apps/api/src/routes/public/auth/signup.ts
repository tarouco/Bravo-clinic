import { signupSchema } from '@bravo/core';
import { Hono } from 'hono';
import { setSessionCookie } from '../../../auth/session';
import { requestMeta } from '../../../lib/request-meta';
import { validate } from '../../../middleware/validate';
import { signup } from '../../../modules/auth/signup.service';
import type { AppEnv } from '../../../types';

/** `POST /public/auth/signup` (FND-43..47). */
export function signupRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.post('/signup', validate('json', signupSchema), async (c) => {
    const result = await signup(c.var.deps, c.req.valid('json'), requestMeta(c));
    setSessionCookie(c, result.session.token, result.session.maxAgeSeconds);
    return c.json({ user: result.user }, 201);
  });
  return app;
}
