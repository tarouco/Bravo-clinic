import { Hono } from 'hono';
import type { AppEnv } from '../../../types';
import { logoutRoutes } from './logout';
import { totpRoutes } from './totp';
import { resendVerificationRoutes } from './verify-email';

/** Auth actions of a signed-in user, mounted at `/app/auth`. */
export function appAuthRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.route('/', logoutRoutes());
  app.route('/', resendVerificationRoutes());
  app.route('/', totpRoutes());
  return app;
}
