import { adminRescheduleSchema, idSchema } from '@bravo/core';
import { Hono } from 'hono';
import { z } from 'zod';
import { notFound } from '../../lib/errors';
import { actorContext } from '../../lib/request-meta';
import { requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { loadBookingDetail } from '../../modules/booking/booking-serializer.service';
import { rescheduleBooking } from '../../modules/booking/reschedule.service';
import { getRoomById } from '../../modules/calendar/calendar.repo';
import { bookings } from '../../db/schema';
import { eq } from 'drizzle-orm';
import type { AppEnv } from '../../types';

const idParam = z.object({ id: idSchema });

/** `POST /admin/bookings/:id/reschedule` (NUC-149): admin only, optionally outside the policy. */
export function adminBookingRescheduleRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post(
    '/bookings/:id/reschedule',
    requireRole('admin'),
    validate('param', idParam),
    validate('json', adminRescheduleSchema),
    async (c) => {
      const deps = c.var.deps;
      const body = c.req.valid('json');
      const bookingId = c.req.valid('param').id;
      const [booking] = await deps.db.select().from(bookings).where(eq(bookings.id, bookingId));
      if (booking === undefined) throw notFound();
      const room = await getRoomById(deps.db, body.roomId ?? booking.roomId);
      if (room === null) throw notFound();
      const outcome = await rescheduleBooking(deps, actorContext(c), {
        bookingId,
        actor: { kind: 'admin' },
        target: {
          roomSlug: room.slug,
          date: body.date,
          startMinute: body.startMinute,
          endMinute: body.endMinute,
        },
        exception: body.exception,
        differenceHandling: body.differenceHandling,
        justification: body.justification,
      });
      if (outcome.kind !== 'moved') throw new Error('admin reschedule never waits for payment');
      const detail = await loadBookingDetail(deps.db, outcome.booking, deps.now(), deps.registry);
      return c.json({ ...detail, creditCents: outcome.creditCents });
    },
  );

  return app;
}
