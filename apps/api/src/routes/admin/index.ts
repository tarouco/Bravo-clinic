import { Hono } from 'hono';
import type { AppEnv } from '../../types';
import { adminBlockRoutes } from './blocks';
import { adminCalendarRoutes } from './calendar';
import { adminCalendarExceptionRoutes } from './calendar-exceptions';
import { adminSessionRoutes } from './session';
import { adminSettingsRoutes } from './settings';

/** Everything under `/admin/*`; CSRF, auth and the staff + MFA guard are applied by `createApp`. */
export function adminRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.route('/', adminSessionRoutes());
  app.route('/', adminCalendarRoutes());
  app.route('/', adminCalendarExceptionRoutes());
  app.route('/', adminSettingsRoutes());
  app.route('/', adminBlockRoutes());
  return app;
}
