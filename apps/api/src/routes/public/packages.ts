import { idSchema, localDateSchema } from '@bravo/core';
import { Hono } from 'hono';
import { z } from 'zod';
import { publicCalendarRateLimit } from '../../middleware/public-rate-limit';
import { validate } from '../../middleware/validate';
import { checkOccurrences, listPackageOffers } from '../../modules/subscriptions/quote.service';
import type { AppEnv } from '../../types';

const categoryParam = z.object({ categoryId: idSchema });
const occurrenceQuery = z.object({ roomId: idSchema, baseOn: localDateSchema });

/** `GET /public/packages` and the fixed-schedule occurrence check (REC-84, REC-155). */
export function packageRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/packages', async (c) => c.json({ items: await listPackageOffers(c.var.deps.db) }));

  app.get(
    '/packages/:categoryId/occurrences',
    publicCalendarRateLimit(),
    validate('param', categoryParam),
    validate('query', occurrenceQuery),
    async (c) => {
      const { db, now } = c.var.deps;
      const { roomId, baseOn } = c.req.valid('query');
      return c.json(
        await checkOccurrences(db, {
          categoryId: c.req.valid('param').categoryId,
          roomId,
          baseOn,
          now: now(),
        }),
      );
    },
  );

  return app;
}
