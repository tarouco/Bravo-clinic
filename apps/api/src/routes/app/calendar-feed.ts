import { Hono } from 'hono';
import { withTransaction } from '../../db/client';
import { actorContext } from '../../lib/request-meta';
import {
  issueFeed,
  personalFeedStatus,
  revokePersonalFeed,
} from '../../modules/ics/ics-feed.service';
import type { AppEnv } from '../../types';

/** The session user's personal calendar feed (GES-45, GES-46). */
export function calendarFeedRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/calendar-feed', async (c) =>
    c.json(await personalFeedStatus(c.var.deps.db, c.get('auth').userId)),
  );

  app.post('/calendar-feed', async (c) => {
    const { db, env, now } = c.var.deps;
    const ctx = actorContext(c);
    const userId = c.get('auth').userId;
    const issued = await withTransaction(db, (tx) =>
      issueFeed(tx, ctx, { scope: 'user', userId }, { env, now: now() }),
    );
    return c.json({ url: issued.url }, 201);
  });

  app.delete('/calendar-feed', async (c) => {
    const { db, now } = c.var.deps;
    const ctx = actorContext(c);
    const userId = c.get('auth').userId;
    await withTransaction(db, (tx) => revokePersonalFeed(tx, ctx, userId, now()));
    return c.body(null, 204);
  });
  return app;
}
