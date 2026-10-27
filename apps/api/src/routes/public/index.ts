import { Hono } from 'hono';
import type { AppEnv } from '../../types';
import { publicAuthRoutes } from './auth';
import { availabilityRoutes } from './availability';
import { catalogRoutes } from './catalog';
import { configRoutes } from './config';
import { publicExtraServiceRoutes } from './extra-services';
import { packageRoutes } from './packages';
import { paymentConfigRoutes } from './payment-config';
import { preReservationRoutes } from './pre-reservations';
import { quoteRoutes } from './quote';
import { publicQuoteRequestRoutes } from './quote-requests';
import { sandboxRoutes } from './sandbox';

/** Everything under `/public/*`: no session required. */
export function publicRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.route('/auth', publicAuthRoutes());
  app.route('/', configRoutes());
  app.route('/', availabilityRoutes());
  app.route('/', catalogRoutes());
  app.route('/', packageRoutes());
  app.route('/', quoteRoutes());
  app.route('/', paymentConfigRoutes());
  app.route('/', preReservationRoutes());
  app.route('/', sandboxRoutes());
  app.route('/', publicExtraServiceRoutes());
  app.route('/', publicQuoteRequestRoutes());
  return app;
}
