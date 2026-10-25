import { Hono } from 'hono';
import type { AppEnv } from '../../../types';
import { loginRoutes } from './login';
import { signupRoutes } from './signup';
import { verifyEmailRoutes } from './verify-email';

/** Unauthenticated auth flows, mounted at `/public/auth`. */
export function publicAuthRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.route('/', signupRoutes());
  app.route('/', loginRoutes());
  app.route('/', verifyEmailRoutes());
  return app;
}
