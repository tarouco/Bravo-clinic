import { Hono } from 'hono';
import { z } from 'zod';
import { publicCalendarRateLimit } from '../../middleware/public-rate-limit';
import { validate } from '../../middleware/validate';
import { resolvePaymentLinkToken } from '../../modules/booking/staff-booking.service';
import type { AppEnv } from '../../types';

const tokenParam = z.object({ token: z.string().min(1).max(200) });

/** `GET /public/pre-reservations/:token` (NUC-165): what the payment link points at. */
export function preReservationRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.get(
    '/pre-reservations/:token',
    publicCalendarRateLimit(),
    validate('param', tokenParam),
    async (c) => {
      const { db, now } = c.var.deps;
      return c.json(await resolvePaymentLinkToken(db, c.req.valid('param').token, now()));
    },
  );
  return app;
}
