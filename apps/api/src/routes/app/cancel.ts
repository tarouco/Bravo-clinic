import { cancelRequestSchema, idSchema } from '@bravo/core';
import { Hono } from 'hono';
import { z } from 'zod';
import { idempotent } from '../../lib/idempotency';
import { actorContext } from '../../lib/request-meta';
import { validate } from '../../middleware/validate';
import {
  loadBookingDetail,
  loadOwnedBooking,
} from '../../modules/booking/booking-serializer.service';
import { cancelBooking, previewCancellation } from '../../modules/booking/cancel.service';
import type { AppEnv } from '../../types';

const idParam = z.object({ id: idSchema });

/** Tenant cancellation: preview what is kept and returned, then cancel (NUC-150..NUC-152). */
export function cancelRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/bookings/:id/cancellation-preview', validate('param', idParam), async (c) => {
    const { db, now, registry } = c.var.deps;
    const booking = await loadOwnedBooking(db, c.req.valid('param').id, c.get('auth').userId);
    const preview = previewCancellation(booking, now(), 'tenant', registry);
    return c.json({
      retainedCents: preview.retainedCents,
      refundCents: preview.refundCents,
      minutesReturned: preview.minutesReturned,
      creditCents: preview.creditCents,
    });
  });

  app.post(
    '/bookings/:id/cancel',
    idempotent(),
    validate('param', idParam),
    validate('json', cancelRequestSchema),
    async (c) => {
      const deps = c.var.deps;
      const cancelled = await cancelBooking(deps, actorContext(c), {
        bookingId: c.req.valid('param').id,
        actor: { kind: 'tenant', userId: c.get('auth').userId },
        reason: c.req.valid('json').reason,
      });
      return c.json(await loadBookingDetail(deps.db, cancelled, deps.now(), deps.registry));
    },
  );

  return app;
}
