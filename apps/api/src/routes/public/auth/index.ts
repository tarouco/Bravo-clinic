import { Hono } from 'hono';
import type { AppEnv } from '../../../types';
import { signupRoutes } from './signup';

/** Unauthenticated auth flows, mounted at `/public/auth`. */
export function publicAuthRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.route('/', signupRoutes());
  return app;
}
