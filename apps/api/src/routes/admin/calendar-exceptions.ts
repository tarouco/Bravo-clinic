import {
  closedDayCreateSchema,
  closedDayPreviewQuerySchema,
  closedDaysQuerySchema,
  holidayCreateSchema,
  holidayImportSchema,
  holidaysQuerySchema,
  holidayUpdateSchema,
  idSchema,
} from '@bravo/core';
import { Hono } from 'hono';
import { z } from 'zod';
import { withTransaction } from '../../db/client';
import { actorContext } from '../../lib/request-meta';
import { requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { importNationalHolidays } from '../../modules/calendar/holiday-import';
import {
  createClosedDays,
  createHoliday,
  deleteClosedDay,
  deleteHoliday,
  listClosedDays,
  listHolidays,
  previewClosedDay,
  updateHoliday,
} from '../../modules/calendar/exceptions.service';
import type { AppEnv } from '../../types';

const idParam = z.object({ id: idSchema });

/** Holidays and closed days (NUC-43..NUC-51); everything is admin only except listing closed days. */
export function adminCalendarExceptionRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const admin = requireRole('admin');

  app.get('/calendar/holidays', admin, validate('query', holidaysQuerySchema), async (c) => {
    const { db, now } = c.var.deps;
    return c.json({ items: await listHolidays(db, c.req.valid('query').year, now()) });
  });

  app.post('/calendar/holidays', admin, validate('json', holidayCreateSchema), async (c) => {
    const { db, now } = c.var.deps;
    const ctx = actorContext(c);
    const holiday = await withTransaction(db, (tx) =>
      createHoliday(tx, c.req.valid('json'), ctx, now()),
    );
    return c.json(holiday, 201);
  });

  // Declared before `/:id` routes so that "import" is never read as an id.
  app.post('/calendar/holidays/import', admin, validate('json', holidayImportSchema), async (c) => {
    const { db, fetch, now } = c.var.deps;
    const { year } = c.req.valid('json');
    return c.json(await importNationalHolidays(db, year, { fetch, now, ctx: actorContext(c) }));
  });

  app.patch(
    '/calendar/holidays/:id',
    admin,
    validate('param', idParam),
    validate('json', holidayUpdateSchema),
    async (c) => {
      const { db, now } = c.var.deps;
      const ctx = actorContext(c);
      const { id } = c.req.valid('param');
      return c.json(
        await withTransaction(db, (tx) => updateHoliday(tx, id, c.req.valid('json'), ctx, now())),
      );
    },
  );

  app.delete('/calendar/holidays/:id', admin, validate('param', idParam), async (c) => {
    const ctx = actorContext(c);
    const { id } = c.req.valid('param');
    await withTransaction(c.var.deps.db, (tx) => deleteHoliday(tx, id, ctx));
    return c.body(null, 204);
  });

  app.get('/calendar/closed-days', validate('query', closedDaysQuerySchema), async (c) => {
    const { from, to } = c.req.valid('query');
    return c.json({ items: await listClosedDays(c.var.deps.db, from, to) });
  });

  app.get(
    '/calendar/closed-days/preview',
    admin,
    validate('query', closedDayPreviewQuerySchema),
    async (c) => {
      const { db, now, registry } = c.var.deps;
      return c.json(await previewClosedDay(db, c.req.valid('query'), registry, now()));
    },
  );

  app.post('/calendar/closed-days', admin, validate('json', closedDayCreateSchema), async (c) => {
    const { db, now, registry } = c.var.deps;
    const ctx = actorContext(c);
    const result = await withTransaction(db, (tx) =>
      createClosedDays(tx, c.req.valid('json'), ctx, registry, now()),
    );
    return c.json(result, 201);
  });

  app.delete('/calendar/closed-days/:id', admin, validate('param', idParam), async (c) => {
    const ctx = actorContext(c);
    const { id } = c.req.valid('param');
    await withTransaction(c.var.deps.db, (tx) => deleteClosedDay(tx, id, ctx));
    return c.body(null, 204);
  });
  return app;
}
