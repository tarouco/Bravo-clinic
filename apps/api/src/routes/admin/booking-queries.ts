import {
  adminBookingsQuerySchema,
  availabilityDayQuerySchema,
  calendarEventsQuerySchema,
  idSchema,
} from '@bravo/core';
import { Hono } from 'hono';
import { z } from 'zod';
import { validate } from '../../middleware/validate';
import { getAdminDay } from '../../modules/availability/availability.service';
import {
  adminCalendarEvents,
  exportBookingsCsv,
  getAdminBooking,
  listAdminBookings,
} from '../../modules/admin/booking-queries.service';
import type { AppEnv } from '../../types';

const idParam = z.object({ id: idSchema });
const roomParam = z.object({ roomId: idSchema });

/** Read models of Gestão de Reservas: calendar feed, day grid, list, CSV and detail (NUC-157, NUC-177, NUC-178). */
export function adminBookingQueryRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/calendar/events', validate('query', calendarEventsQuerySchema), async (c) => {
    const { db, now } = c.var.deps;
    return c.json(await adminCalendarEvents(db, c.req.valid('query'), now()));
  });

  app.get(
    '/rooms/:roomId/availability',
    validate('param', roomParam),
    validate('query', availabilityDayQuerySchema),
    async (c) => {
      const { db, now } = c.var.deps;
      return c.json(
        await getAdminDay(db, c.req.valid('param').roomId, c.req.valid('query').date, now()),
      );
    },
  );

  app.get('/bookings', validate('query', adminBookingsQuerySchema), async (c) => {
    const { cursor, ...filters } = c.req.valid('query');
    return c.json(await listAdminBookings(c.var.deps.db, filters, cursor));
  });

  // Declared before `/bookings/:id` so that "export.csv" is never read as an id.
  app.get('/bookings/export.csv', validate('query', adminBookingsQuerySchema), async (c) => {
    // The cursor of the list query is ignored: the export is never paginated.
    const csv = await exportBookingsCsv(c.var.deps.db, c.req.valid('query'));
    return c.body(csv, 200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="reservas.csv"',
    });
  });

  app.get('/bookings/:id', validate('param', idParam), async (c) => {
    const { db, now, registry } = c.var.deps;
    return c.json(await getAdminBooking(db, c.req.valid('param').id, now(), registry));
  });

  return app;
}
