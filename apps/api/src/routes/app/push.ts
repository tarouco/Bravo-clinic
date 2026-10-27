import { pushSubscriptionSchema } from '@bravo/core';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { pushSubscriptions } from '../../db/schema';
import { validate } from '../../middleware/validate';
import type { AppEnv } from '../../types';

const deleteSchema = z.object({ endpoint: z.string().min(1).max(1000) });

/** Web push subscriptions of the signed-in user (GES-76, GES-77). */
export function pushRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // Upsert by endpoint: a browser reused by another account moves to that account (GES-76).
  app.post('/push/subscriptions', validate('json', pushSubscriptionSchema), async (c) => {
    const { endpoint, keys } = c.req.valid('json');
    const userId = c.get('auth').userId;
    const userAgent = c.req.header('User-Agent')?.slice(0, 500) ?? null;
    const values = { userId, p256dh: keys.p256dh, auth: keys.auth, userAgent, failureCount: 0 };
    await c.var.deps.db
      .insert(pushSubscriptions)
      .values({ endpoint, ...values })
      .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: values });
    return c.json({ endpoint }, 201);
  });

  app.delete('/push/subscriptions', validate('json', deleteSchema), async (c) => {
    await c.var.deps.db
      .delete(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.endpoint, c.req.valid('json').endpoint),
          eq(pushSubscriptions.userId, c.get('auth').userId),
        ),
      );
    return c.body(null, 204);
  });

  return app;
}
