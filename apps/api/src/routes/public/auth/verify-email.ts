import { Hono } from 'hono';
import { z } from 'zod';
import { validate } from '../../../middleware/validate';
import { verifyEmail } from '../../../modules/auth/email-verification.service';
import type { AppEnv } from '../../../types';

const verifyEmailSchema = z.object({
  token: z.string({ error: 'Link inválido' }).min(1, { error: 'Link inválido' }),
});

/** `POST /public/auth/verify-email` (FND-48, FND-49). */
export function verifyEmailRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.post('/verify-email', validate('json', verifyEmailSchema), async (c) => {
    await verifyEmail(c.var.deps, c.req.valid('json').token);
    return c.json({ verified: true });
  });
  return app;
}
