import { couponInput, couponToggleInput, idSchema } from '@bravo/core';
import { Hono } from 'hono';
import { z } from 'zod';
import { withTransaction } from '../../db/client';
import { actorContext } from '../../lib/request-meta';
import { requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import {
  createCoupon,
  listCoupons,
  listUses,
  setCouponEnabled,
  updateCoupon,
} from '../../modules/coupons/coupons.service';
import type { AppEnv } from '../../types';

const idParam = z.object({ id: idSchema });

/** Admin Cupons (REC-128..REC-132): every route is admin-only. */
export function adminCouponRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('/coupons', requireRole('admin'));
  app.use('/coupons/*', requireRole('admin'));

  app.get('/coupons', async (c) => c.json({ items: await listCoupons(c.var.deps.db) }));

  app.post('/coupons', validate('json', couponInput), async (c) => {
    const { db, now } = c.var.deps;
    const ctx = actorContext(c);
    const coupon = await withTransaction(db, (tx) =>
      createCoupon(tx, ctx, c.req.valid('json'), now()),
    );
    return c.json(coupon, 201);
  });

  app.put('/coupons/:id', validate('param', idParam), validate('json', couponInput), async (c) => {
    const { db, now } = c.var.deps;
    const ctx = actorContext(c);
    const coupon = await withTransaction(db, (tx) =>
      updateCoupon(tx, ctx, c.req.valid('param').id, c.req.valid('json'), now()),
    );
    return c.json(coupon);
  });

  app.patch(
    '/coupons/:id/enabled',
    validate('param', idParam),
    validate('json', couponToggleInput),
    async (c) => {
      const { db, now } = c.var.deps;
      const ctx = actorContext(c);
      const coupon = await withTransaction(db, (tx) =>
        setCouponEnabled(tx, ctx, c.req.valid('param').id, c.req.valid('json').enabled, now()),
      );
      return c.json(coupon);
    },
  );

  app.get('/coupons/:id/uses', validate('param', idParam), async (c) =>
    c.json({ items: await listUses(c.var.deps.db, c.req.valid('param').id) }),
  );

  return app;
}
