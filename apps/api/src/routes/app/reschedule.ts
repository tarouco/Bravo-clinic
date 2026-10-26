import { idSchema, rescheduleQuoteRequestSchema, rescheduleRequestSchema } from '@bravo/core';
import { Hono } from 'hono';
import { z } from 'zod';
import { idempotent } from '../../lib/idempotency';
import { actorContext } from '../../lib/request-meta';
import { validate } from '../../middleware/validate';
import {
  loadBookingDetail,
  loadOwnedBooking,
} from '../../modules/booking/booking-serializer.service';
import {
  quoteReschedule,
  rescheduleBooking,
  type RescheduleTarget,
} from '../../modules/booking/reschedule.service';
import { getRoomById } from '../../modules/calendar/calendar.repo';
import { chargeIntentOf } from '../../modules/payments/charges.service';
import { notFound } from '../../lib/errors';
import type { AppEnv } from '../../types';

const idParam = z.object({ id: idSchema });

/** Tenant reschedule: quote then apply (NUC-142..NUC-148). */
export function rescheduleRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  /** The target room: the one named by the request, else the booking's own. */
  async function targetOf(
    db: AppEnv['Variables']['deps']['db'],
    roomId: string,
    body: {
      roomSlug?: string | undefined;
      date: RescheduleTarget['date'];
      startMinute: number;
      endMinute: number;
    },
  ): Promise<RescheduleTarget> {
    let roomSlug = body.roomSlug;
    if (roomSlug === undefined) {
      const room = await getRoomById(db, roomId);
      if (room === null) throw notFound();
      roomSlug = room.slug;
    }
    return { roomSlug, date: body.date, startMinute: body.startMinute, endMinute: body.endMinute };
  }

  app.post(
    '/bookings/:id/reschedule/quote',
    validate('param', idParam),
    validate('json', rescheduleQuoteRequestSchema),
    async (c) => {
      const deps = c.var.deps;
      const booking = await loadOwnedBooking(
        deps.db,
        c.req.valid('param').id,
        c.get('auth').userId,
      );
      const target = await targetOf(deps.db, booking.roomId, c.req.valid('json'));
      return c.json(await quoteReschedule(deps.db, deps, booking, target));
    },
  );

  app.post(
    '/bookings/:id/reschedule',
    idempotent(),
    validate('param', idParam),
    validate('json', rescheduleRequestSchema),
    async (c) => {
      const deps = c.var.deps;
      const userId = c.get('auth').userId;
      const body = c.req.valid('json');
      const bookingId = c.req.valid('param').id;
      const booking = await loadOwnedBooking(deps.db, bookingId, userId);
      const outcome = await rescheduleBooking(deps, actorContext(c), {
        bookingId,
        actor: { kind: 'tenant', userId },
        target: await targetOf(deps.db, booking.roomId, body),
        method: body.method,
        savedCardId: body.savedCardId,
      });
      if (outcome.kind === 'payment_required') {
        return c.json(
          {
            rescheduleRequestId: outcome.request.id,
            expiresAt: outcome.request.expiresAt.toISOString(),
            charge: chargeIntentOf(outcome.charge),
          },
          202,
        );
      }
      const detail = await loadBookingDetail(deps.db, outcome.booking, deps.now(), deps.registry);
      return c.json({ ...detail, creditCents: outcome.creditCents });
    },
  );

  return app;
}
