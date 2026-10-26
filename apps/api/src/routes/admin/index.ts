import { Hono } from 'hono';
import type { AppEnv } from '../../types';
import { adminBlockRoutes } from './blocks';
import { adminBookingCancelRoutes } from './booking-cancel';
import { adminBookingRescheduleRoutes } from './booking-reschedule';
import { adminBookingQueryRoutes } from './booking-queries';
import { adminBookingRoutes } from './bookings';
import { adminCalendarRoutes } from './calendar';
import { adminCalendarExceptionRoutes } from './calendar-exceptions';
import { adminCategoryRoutes } from './categories';
import { adminCustomerRoutes } from './customers';
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
  app.route('/', adminCategoryRoutes());
  app.route('/', adminBookingRescheduleRoutes());
  app.route('/', adminBookingCancelRoutes());
  app.route('/', adminBookingRoutes());
  app.route('/', adminBookingQueryRoutes());
  app.route('/', adminCustomerRoutes());
  return app;
}
