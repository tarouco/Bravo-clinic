import { Hono } from 'hono';
import { getEnv } from './env';
import { notFoundHandler, onError } from './lib/errors';
import { requestContext } from './middleware/request-context';
import { requireJson } from './middleware/require-json';
import type { AppDeps, AppEnv } from './types';

/** Builds the API. Dependencies are injectable so tests can replace time, fetch and env. */
export function createApp(overrides: Partial<AppDeps> = {}): Hono<AppEnv> {
  const deps: AppDeps = {
    now: () => new Date(),
    fetch: globalThis.fetch,
    env: getEnv(),
    ...overrides,
  };

  const app = new Hono<AppEnv>();
  app.use('*', requestContext());
  app.use('*', async (c, next) => {
    c.set('deps', deps);
    await next();
  });
  app.use('*', requireJson());
  app.onError(onError);
  app.notFound(notFoundHandler);
  return app;
}
