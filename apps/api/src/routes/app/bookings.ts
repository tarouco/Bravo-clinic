import { bookingListQuerySchema, createBookingSchema, idSchema } from '@bravo/core';
import { Hono } from 'hono';
import { z } from 'zod';
import { idempotent } from '../../lib/idempotency';
import { actorContext, requestMeta } from '../../lib/request-meta';
import { requireVerifiedEmail } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { bookingIcs, loadBookingMailContext } from '../../modules/booking/booking-mailer';
import {
  listOwnBookings,
  loadBookingDetail,
  loadOwnedBooking,
} from '../../modules/booking/booking-serializer.service';
import { createBooking } from '../../modules/booking/create-booking.service';
import type { AppEnv } from '../../types';

const idParam = z.object({ id: idSchema });

/** Tenant booking endpoints (NUC-89..NUC-97, NUC-140, NUC-141, NUC-188). */
export function bookingRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post(
    '/bookings',
    requireVerifiedEmail(),
    idempotent(),
    validate('json', createBookingSchema),
    async (c) => {
      const deps = c.var.deps;
      // The quote request is the body minus the checkout-only fields; `acceptPolicy` is always true here.
      const { policyVersion, expectedTotalCents, ...request } = c.req.valid('json');
      const { booking } = await createBooking(
        deps,
        { userId: c.get('auth').userId, request, policyVersion, expectedTotalCents },
        { source: 'web', ctx: actorContext(c), meta: requestMeta(c) },
      );
      return c.json(await loadBookingDetail(deps.db, booking, deps.now(), deps.registry), 201);
    },
  );

  app.get('/bookings', validate('query', bookingListQuerySchema), async (c) => {
    const { db, now } = c.var.deps;
    const { tab, cursor } = c.req.valid('query');
    return c.json(await listOwnBookings(db, c.get('auth').userId, tab, cursor, now()));
  });

  app.get('/bookings/:id', validate('param', idParam), async (c) => {
    const { db, now, registry } = c.var.deps;
    const booking = await loadOwnedBooking(db, c.req.valid('param').id, c.get('auth').userId);
    return c.json(await loadBookingDetail(db, booking, now(), registry));
  });

  app.get('/bookings/:id/ics', validate('param', idParam), async (c) => {
    const { db, env, now } = c.var.deps;
    const booking = await loadOwnedBooking(db, c.req.valid('param').id, c.get('auth').userId);
    const mail = await loadBookingMailContext(db, booking, env);
    const cancelled = booking.status.startsWith('cancelled_') || booking.status === 'expired';
    const calendar = bookingIcs(booking, mail, cancelled ? 'CANCEL' : 'PUBLISH', now());
    return c.body(calendar, 200, {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="reserva-${booking.code}.ics"`,
    });
  });

  return app;
}
