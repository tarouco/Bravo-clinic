import { Hono } from 'hono';
import type { AppEnv } from '../../types';
import { appAuthRoutes } from './auth';
import { meRoutes } from './me';

/** Everything under `/app/*`; the session middleware is applied by `createApp`. */
export function appRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.route('/', meRoutes());
  app.route('/auth', appAuthRoutes());
  return app;
}
