import { Hono } from 'hono';
import { getDb } from './db/client';
import { getEnv } from './env';
import { notFoundHandler, onError } from './lib/errors';
import { requireAuth, requireStaff } from './middleware/auth';
import { requestContext } from './middleware/request-context';
import { requireJson } from './middleware/require-json';
import { healthRoutes } from './routes/health';
import type { AppDeps, AppEnv } from './types';

/** Builds the API. Dependencies are injectable so tests can replace db, time, fetch and env. */
export function createApp(overrides: Partial<AppDeps> = {}): Hono<AppEnv> {
  const deps: AppDeps = {
    now: overrides.now ?? (() => new Date()),
    fetch: overrides.fetch ?? globalThis.fetch,
    env: overrides.env ?? getEnv(),
    db: overrides.db ?? getDb(),
  };

  const app = new Hono<AppEnv>();
  app.use('*', requestContext());
  app.use('*', async (c, next) => {
    c.set('deps', deps);
    await next();
  });
  app.use('*', requireJson());
  app.use('/app/*', requireAuth());
  app.use('/admin/*', requireAuth(), requireStaff());
  app.route('/health', healthRoutes());
  app.onError(onError);
  app.notFound(notFoundHandler);
  return app;
}
