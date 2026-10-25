import { Hono } from 'hono';
import type { AppEnv } from '../../types';
import { adminSessionRoutes } from './session';

/** Everything under `/admin/*`; CSRF, auth and the staff + MFA guard are applied by `createApp`. */
export function adminRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.route('/', adminSessionRoutes());
  return app;
}
