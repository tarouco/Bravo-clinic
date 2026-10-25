import { Hono } from 'hono';
import { resendVerification } from '../../../modules/auth/email-verification.service';
import type { AppEnv } from '../../../types';

/** `POST /app/auth/verify-email/resend` (FND-50). */
export function resendVerificationRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.post('/verify-email/resend', async (c) => {
    await resendVerification(c.var.deps, c.get('auth'));
    return c.json({}, 202);
  });
  return app;
}
