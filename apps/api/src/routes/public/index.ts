import { Hono } from 'hono';
import type { AppEnv } from '../../types';
import { publicAuthRoutes } from './auth';
import { availabilityRoutes } from './availability';
import { configRoutes } from './config';

/** Everything under `/public/*`: no session required. */
export function publicRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.route('/auth', publicAuthRoutes());
  app.route('/', configRoutes());
  app.route('/', availabilityRoutes());
  return app;
}
