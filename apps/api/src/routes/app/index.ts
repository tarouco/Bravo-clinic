import { Hono } from 'hono';
import type { AppEnv } from '../../types';
import { appAuthRoutes } from './auth';
import { cardRoutes } from './cards';
import { meRoutes } from './me';
import { paymentRoutes } from './payments';

/** Everything under `/app/*`; the session middleware is applied by `createApp`. */
export function appRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.route('/', meRoutes());
  app.route('/auth', appAuthRoutes());
  app.route('/', paymentRoutes());
  app.route('/', cardRoutes());
  return app;
}
