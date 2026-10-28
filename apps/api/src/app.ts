import { Hono } from 'hono';
import { getDb } from './db/client';
import { getEnv } from './env';
import { buildRegistry } from './extensions';
import { notFoundHandler, onError } from './lib/errors';
import { createS3Storage } from './lib/storage';
import { requireAuth, requireStaff } from './middleware/auth';
import { csrf } from './middleware/csrf';
import { requestContext } from './middleware/request-context';
import { requireJson } from './middleware/require-json';
import { adminRoutes } from './routes/admin';
import { appRoutes } from './routes/app';
import { healthRoutes } from './routes/health';
import { icsRoutes } from './routes/ics';
import { jobRoutes } from './routes/jobs';
import { mcpRoutes } from './routes/mcp';
import { publicRoutes } from './routes/public';
import { paymentWebhookRoutes } from './routes/webhooks/pagamentos';
import type { AppDeps, AppEnv } from './types';

/** Builds the API. Dependencies are injectable so tests can replace db, time, fetch and env. */
export function createApp(overrides: Partial<AppDeps> = {}): Hono<AppEnv> {
  const env = overrides.env ?? getEnv();
  const base = {
    now: overrides.now ?? (() => new Date()),
    fetch: overrides.fetch ?? globalThis.fetch,
    env,
    db: overrides.db ?? getDb(),
    ...(overrides.webPush !== undefined && { webPush: overrides.webPush }),
  };
  const deps: AppDeps = {
    ...base,
    registry: overrides.registry ?? buildRegistry(base),
    storage: overrides.storage ?? createS3Storage(env),
    ...(overrides.googleJwks !== undefined && { googleJwks: overrides.googleJwks }),
    ...(overrides.verifyTrigger !== undefined && { verifyTrigger: overrides.verifyTrigger }),
    ...(overrides.mcpTools !== undefined && { mcpTools: overrides.mcpTools }),
  };

  const app = new Hono<AppEnv>();
  app.use('*', requestContext());
  app.use('*', async (c, next) => {
    c.set('deps', deps);
    await next();
  });
  app.use('*', requireJson());
  app.use('/app/*', csrf(deps.env.APP_BASE_URL), requireAuth());
  app.use('/admin/*', csrf(deps.env.APP_BASE_URL), requireAuth(), requireStaff());
  app.route('/health', healthRoutes());
  app.route('/public', publicRoutes());
  app.route('/app', appRoutes());
  app.route('/admin', adminRoutes());
  app.route('/webhooks/pagamentos', paymentWebhookRoutes());
  app.route('/jobs', jobRoutes());
  app.route('/ics', icsRoutes());
  app.route('/mcp', mcpRoutes());
  app.onError(onError);
  app.notFound(notFoundHandler);
  return app;
}
