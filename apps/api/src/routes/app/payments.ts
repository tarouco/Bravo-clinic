import { idSchema, payBalanceRequestSchema, payRequestSchema } from '@bravo/core';
import { Hono } from 'hono';
import { z } from 'zod';
import { idempotent } from '../../lib/idempotency';
import { actorContext, requestMeta } from '../../lib/request-meta';
import { validate } from '../../middleware/validate';
import {
  chargeIntentOf,
  createBalanceChargeForBooking,
  createChargeForBooking,
} from '../../modules/payments/charges.service';
import type { AppEnv } from '../../types';

const idParam = z.object({ id: idSchema });

/** Tenant payment endpoints (NUC-107..NUC-111, NUC-134, NUC-135); both need `Idempotency-Key`. */
export function paymentRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post(
    '/bookings/:id/pay',
    idempotent(),
    validate('param', idParam),
    validate('json', payRequestSchema),
    async (c) => {
      const charge = await createChargeForBooking(c.var.deps, actorContext(c), requestMeta(c), {
        ...c.req.valid('json'),
        bookingId: c.req.valid('param').id,
        userId: c.get('auth').userId,
      });
      return c.json(chargeIntentOf(charge));
    },
  );

  app.post(
    '/bookings/:id/pay-balance',
    idempotent(),
    validate('param', idParam),
    validate('json', payBalanceRequestSchema),
    async (c) => {
      const charge = await createBalanceChargeForBooking(c.var.deps, actorContext(c), {
        ...c.req.valid('json'),
        bookingId: c.req.valid('param').id,
        userId: c.get('auth').userId,
      });
      return c.json(chargeIntentOf(charge));
    },
  );

  return app;
}
