import { createBookingSchema } from '@bravo/core';
import { Hono } from 'hono';
import { idempotent } from '../../lib/idempotency';
import { actorContext, requestMeta } from '../../lib/request-meta';
import { requireVerifiedEmail } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { loadBookingDetail } from '../../modules/booking/booking-serializer.service';
import { createBooking } from '../../modules/booking/create-booking.service';
import type { AppEnv } from '../../types';

/** Tenant booking endpoints (NUC-89..NUC-97, NUC-141, NUC-188). */
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

  return app;
}
