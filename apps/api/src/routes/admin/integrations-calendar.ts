import { idSchema } from '@bravo/core';
import { Hono } from 'hono';
import { z } from 'zod';
import { withTransaction } from '../../db/client';
import { actorContext } from '../../lib/request-meta';
import { validate } from '../../middleware/validate';
import { issueFeed, listSharedFeeds, revokeFeed } from '../../modules/ics/ics-feed.service';
import type { AppEnv } from '../../types';

const feedInputSchema = z
  .object({
    scope: z.enum(['clinic', 'room'], { error: 'Escolha o tipo de agenda' }),
    roomId: idSchema.optional(),
  })
  .refine((v) => v.scope !== 'room' || v.roomId !== undefined, {
    error: 'Escolha a sala',
    path: ['roomId'],
  });

const idParam = z.object({ id: idSchema });

/** Clinic and room calendar feeds (GES-42, GES-43); `adminRoutes` limits them to admins (GES-120). */
export function adminIntegrationsCalendarRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.get('/integrations/calendar', async (c) => c.json(await listSharedFeeds(c.var.deps.db)));

  app.post('/integrations/calendar/feeds', validate('json', feedInputSchema), async (c) => {
    const { db, env, now } = c.var.deps;
    const ctx = actorContext(c);
    const input = c.req.valid('json');
    const issued = await withTransaction(db, (tx) =>
      issueFeed(
        tx,
        ctx,
        { scope: input.scope, ...(input.scope === 'room' && { roomId: input.roomId }) },
        { env, now: now() },
      ),
    );
    return c.json({ url: issued.url, prefix: issued.prefix }, 201);
  });

  app.delete('/integrations/calendar/feeds/:id', validate('param', idParam), async (c) => {
    const { db, now } = c.var.deps;
    const ctx = actorContext(c);
    await withTransaction(db, (tx) => revokeFeed(tx, ctx, c.req.valid('param').id, now()));
    return c.body(null, 204);
  });
  return app;
}
