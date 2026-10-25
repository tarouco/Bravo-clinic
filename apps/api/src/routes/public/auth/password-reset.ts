import { passwordResetConfirmSchema, passwordResetRequestSchema } from '@bravo/core';
import { Hono } from 'hono';
import { requestMeta } from '../../../lib/request-meta';
import { validate } from '../../../middleware/validate';
import {
  confirmPasswordReset,
  requestPasswordReset,
} from '../../../modules/auth/password-reset.service';
import type { AppEnv } from '../../../types';

/** `POST /public/auth/password-reset/{request,confirm}` (FND-60..62). */
export function passwordResetRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.post('/password-reset/request', validate('json', passwordResetRequestSchema), async (c) => {
    await requestPasswordReset(c.var.deps, c.req.valid('json').email);
    return c.json({}, 202);
  });
  app.post('/password-reset/confirm', validate('json', passwordResetConfirmSchema), async (c) => {
    await confirmPasswordReset(c.var.deps, c.req.valid('json'), requestMeta(c));
    return c.json({});
  });
  return app;
}
