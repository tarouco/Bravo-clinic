import { customerNotesSchema, customerProfileSchema, idSchema } from '@bravo/core';
import { Hono } from 'hono';
import { z } from 'zod';
import { withTransaction } from '../../db/client';
import { actorContext } from '../../lib/request-meta';
import { requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import {
  getCustomerDetail,
  listCustomerBookings,
  saveCustomerNotes,
  searchCustomerProfiles,
  updateCustomerProfile,
} from '../../modules/customers/customers.service';
import type { AppEnv } from '../../types';

const idParam = z.object({ id: idSchema });
const cursorSchema = z.string().min(1).max(200).optional();
const listQuery = z.object({ q: z.string().max(120).optional(), cursor: cursorSchema });

/**
 * Clientes (GES-99..GES-102). Staff (admin and reception) read and save notes; the profile edit
 * is admin only. Mounted after nucleo's `/customers/search`.
 */
export function adminCustomerProfileRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/customers', validate('query', listQuery), async (c) =>
    c.json(await searchCustomerProfiles(c.var.deps.db, c.req.valid('query'))),
  );

  app.get('/customers/:id', validate('param', idParam), async (c) => {
    const { db, now } = c.var.deps;
    return c.json(await getCustomerDetail(db, c.req.valid('param').id, now()));
  });

  app.get(
    '/customers/:id/bookings',
    validate('param', idParam),
    validate('query', z.object({ cursor: cursorSchema })),
    async (c) =>
      c.json(
        await listCustomerBookings(
          c.var.deps.db,
          c.req.valid('param').id,
          c.req.valid('query').cursor,
        ),
      ),
  );

  app.patch(
    '/customers/:id/notes',
    validate('param', idParam),
    validate('json', customerNotesSchema),
    async (c) => {
      const { db, now } = c.var.deps;
      const ctx = actorContext(c);
      const saved = await withTransaction(db, (tx) =>
        saveCustomerNotes(tx, ctx, c.req.valid('param').id, c.req.valid('json').notes, now()),
      );
      return c.json(saved);
    },
  );

  app.patch(
    '/customers/:id',
    requireRole('admin'),
    validate('param', idParam),
    validate('json', customerProfileSchema),
    async (c) => {
      const { db, now } = c.var.deps;
      const ctx = actorContext(c);
      const profile = await withTransaction(db, (tx) =>
        updateCustomerProfile(tx, ctx, c.req.valid('param').id, c.req.valid('json'), now()),
      );
      return c.json(profile);
    },
  );
  return app;
}
