import { businessHoursUpdateSchema, calendarSettingsSchema } from '@bravo/core';
import { Hono } from 'hono';
import { withTransaction } from '../../db/client';
import { actorContext } from '../../lib/request-meta';
import { requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import {
  getCalendarConfig,
  updateBusinessHours,
  updateCalendarSettings,
} from '../../modules/calendar/calendar-config.service';
import type { AppEnv } from '../../types';

/** `/admin/calendar/config`, `/business-hours` and `/settings`: admin only (NUC-32..NUC-38). */
export function adminCalendarRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/calendar/config', requireRole('admin'), async (c) =>
    c.json(await getCalendarConfig(c.var.deps.db)),
  );

  app.put(
    '/calendar/business-hours',
    requireRole('admin'),
    validate('json', businessHoursUpdateSchema),
    async (c) => {
      const { db, now } = c.var.deps;
      const { rows } = c.req.valid('json');
      const ctx = actorContext(c);
      const businessHours = await withTransaction(db, (tx) =>
        updateBusinessHours(tx, rows, ctx, now()),
      );
      return c.json({ businessHours });
    },
  );

  app.put(
    '/calendar/settings',
    requireRole('admin'),
    validate('json', calendarSettingsSchema),
    async (c) => {
      const { db, now } = c.var.deps;
      const ctx = actorContext(c);
      return c.json(
        await withTransaction(db, (tx) =>
          updateCalendarSettings(tx, c.req.valid('json'), ctx, now()),
        ),
      );
    },
  );
  return app;
}
