import { availabilityDayQuerySchema, availabilityMonthQuerySchema, roomSlugSchema } from '@bravo/core';
import { Hono } from 'hono';
import { z } from 'zod';
import { getDayAvailability, getMonthAvailability } from '../../modules/availability/availability.service';
import { publicCalendarRateLimit } from '../../middleware/public-rate-limit';
import { validate } from '../../middleware/validate';
import type { AppEnv } from '../../types';

const slugParam = z.object({ slug: roomSlugSchema });

/** `GET /public/rooms/:slug/availability` and `/availability/month` (NUC-77..NUC-83). */
export function availabilityRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('/rooms/:slug/availability', publicCalendarRateLimit());
  app.use('/rooms/:slug/availability/month', publicCalendarRateLimit());

  app.get(
    '/rooms/:slug/availability',
    validate('param', slugParam),
    validate('query', availabilityDayQuerySchema),
    async (c) => {
      const { db, now, registry } = c.var.deps;
      const { slug } = c.req.valid('param');
      const { date } = c.req.valid('query');
      return c.json(await getDayAvailability(db, slug, date, now(), registry));
    },
  );

  app.get(
    '/rooms/:slug/availability/month',
    validate('param', slugParam),
    validate('query', availabilityMonthQuerySchema),
    async (c) => {
      const { db, now, registry } = c.var.deps;
      const { slug } = c.req.valid('param');
      const { month } = c.req.valid('query');
      return c.json(await getMonthAvailability(db, slug, month, now(), registry));
    },
  );
  return app;
}
