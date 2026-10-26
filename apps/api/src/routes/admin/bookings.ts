import {
  cleanupExceptionSchema,
  confirmManualSchema,
  idSchema,
  staffCreateBookingSchema,
} from '@bravo/core';
import { Hono } from 'hono';
import { z } from 'zod';
import { actorContext } from '../../lib/request-meta';
import { requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { loadBookingDetail } from '../../modules/booking/booking-serializer.service';
import {
  checkIn,
  confirmManual,
  resendPaymentLink,
  setCleanupException,
  staffCreateBooking,
} from '../../modules/booking/staff-booking.service';
import type { AppEnv } from '../../types';

const idParam = z.object({ id: idSchema });

/** Staff booking operations (NUC-39, NUC-161..NUC-164, NUC-167). */
export function adminBookingRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post('/bookings', validate('json', staffCreateBookingSchema), async (c) => {
    const deps = c.var.deps;
    const auth = c.get('auth');
    const { booking, paymentLink } = await staffCreateBooking(
      deps,
      actorContext(c),
      { id: auth.userId, role: auth.role === 'admin' ? 'admin' : 'reception' },
      c.req.valid('json'),
    );
    const detail = await loadBookingDetail(deps.db, booking, deps.now(), deps.registry);
    return c.json({ ...detail, paymentLink }, 201);
  });

  app.post(
    '/bookings/:id/confirm-manual',
    requireRole('admin'),
    validate('param', idParam),
    validate('json', confirmManualSchema),
    async (c) => {
      const deps = c.var.deps;
      const booking = await confirmManual(
        deps,
        actorContext(c),
        c.req.valid('param').id,
        c.req.valid('json').justification,
      );
      return c.json(await loadBookingDetail(deps.db, booking, deps.now(), deps.registry));
    },
  );

  app.post('/bookings/:id/resend-link', validate('param', idParam), async (c) => {
    const paymentLink = await resendPaymentLink(
      c.var.deps,
      actorContext(c),
      c.req.valid('param').id,
    );
    return c.json({ paymentLink });
  });

  app.post('/bookings/:id/check-in', validate('param', idParam), async (c) => {
    const deps = c.var.deps;
    const booking = await checkIn(deps, actorContext(c), c.req.valid('param').id);
    return c.json(await loadBookingDetail(deps.db, booking, deps.now(), deps.registry));
  });

  app.patch(
    '/bookings/:id/cleanup',
    requireRole('admin'),
    validate('param', idParam),
    validate('json', cleanupExceptionSchema),
    async (c) => {
      const deps = c.var.deps;
      const booking = await setCleanupException(
        deps,
        actorContext(c),
        c.req.valid('param').id,
        c.req.valid('json'),
      );
      return c.json(await loadBookingDetail(deps.db, booking, deps.now(), deps.registry));
    },
  );

  return app;
}
