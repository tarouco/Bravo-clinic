import { Hono } from 'hono';
import type { AppEnv } from '../../types';
import { publicAuthRoutes } from './auth';
import { availabilityRoutes } from './availability';
import { catalogRoutes } from './catalog';
import { configRoutes } from './config';
import { quoteRoutes } from './quote';

/** Everything under `/public/*`: no session required. */
export function publicRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.route('/auth', publicAuthRoutes());
  app.route('/', configRoutes());
  app.route('/', availabilityRoutes());
  app.route('/', catalogRoutes());
  app.route('/', quoteRoutes());
  return app;
}
