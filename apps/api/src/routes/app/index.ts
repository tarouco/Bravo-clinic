import { Hono } from 'hono';
import type { AppEnv } from '../../types';
import { appAuthRoutes } from './auth';
import { bookingRoutes } from './bookings';
import { cancelRoutes } from './cancel';
import { cardRoutes } from './cards';
import { meRoutes } from './me';
import { paymentRoutes } from './payments';
import { purchaseRoutes } from './purchases';
import { rescheduleRoutes } from './reschedule';

/** Everything under `/app/*`; the session middleware is applied by `createApp`. */
export function appRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.route('/', meRoutes());
  app.route('/auth', appAuthRoutes());
  app.route('/', bookingRoutes());
  app.route('/', rescheduleRoutes());
  app.route('/', cancelRoutes());
  app.route('/', paymentRoutes());
  app.route('/', cardRoutes());
  app.route('/', purchaseRoutes());
  return app;
}
