import { Hono } from 'hono';
import type { AppEnv } from '../../../types';
import { googleRoutes } from './google';
import { loginRoutes } from './login';
import { passwordResetRoutes } from './password-reset';
import { signupRoutes } from './signup';
import { verifyEmailRoutes } from './verify-email';

/** Unauthenticated auth flows, mounted at `/public/auth`. */
export function publicAuthRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.route('/', signupRoutes());
  app.route('/', loginRoutes());
  app.route('/', verifyEmailRoutes());
  app.route('/', passwordResetRoutes());
  app.route('/', googleRoutes());
  return app;
}
