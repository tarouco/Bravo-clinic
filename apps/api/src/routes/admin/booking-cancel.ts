import { adminCancelSchema, idSchema } from '@bravo/core';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { bookings } from '../../db/schema';
import { notFound } from '../../lib/errors';
import { actorContext } from '../../lib/request-meta';
import { requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { loadBookingDetail } from '../../modules/booking/booking-serializer.service';
import { cancelBooking, previewCancellation } from '../../modules/booking/cancel.service';
import type { AppEnv } from '../../types';

const idParam = z.object({ id: idSchema });

/** Clinic cancellation (NUC-153): admin only, with what the customer gets back. */
export function adminBookingCancelRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const admin = requireRole('admin');

  app.get('/bookings/:id/cancellation-preview', admin, validate('param', idParam), async (c) => {
    const { db, now, registry } = c.var.deps;
    const [booking] = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, c.req.valid('param').id));
    if (booking === undefined) throw notFound();
    return c.json(previewCancellation(booking, now(), 'clinic', registry));
  });

  app.post(
    '/bookings/:id/cancel',
    admin,
    validate('param', idParam),
    validate('json', adminCancelSchema),
    async (c) => {
      const deps = c.var.deps;
      const body = c.req.valid('json');
      const cancelled = await cancelBooking(deps, actorContext(c), {
        bookingId: c.req.valid('param').id,
        actor: { kind: 'clinic' },
        reason: body.reason,
        resolution: body.resolution,
        justification: body.justification,
      });
      return c.json(await loadBookingDetail(deps.db, cancelled, deps.now(), deps.registry));
    },
  );

  return app;
}
