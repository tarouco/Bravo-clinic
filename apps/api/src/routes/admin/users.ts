import {
  deleteWithJustificationSchema,
  idSchema,
  roleChangeSchema,
  staffUserInputSchema,
} from '@bravo/core';
import { Hono } from 'hono';
import { z } from 'zod';
import { withTransaction } from '../../db/client';
import { actorContext } from '../../lib/request-meta';
import { validate } from '../../middleware/validate';
import {
  inviteStaff,
  listStaffUsers,
  resetStaffTotp,
  updateStaffUser,
} from '../../modules/users/staff-users.service';
import type { AppEnv } from '../../types';

const idParam = z.object({ id: idSchema });

/** Usuários (GES-110..GES-114); `adminRoutes` limits `/users*` to admins. */
export function adminUserRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/users', async (c) => c.json(await listStaffUsers(c.var.deps.db)));

  app.post('/users', validate('json', staffUserInputSchema), async (c) =>
    c.json(await inviteStaff(c.var.deps, actorContext(c), c.req.valid('json')), 201),
  );

  app.patch(
    '/users/:id',
    validate('param', idParam),
    validate('json', roleChangeSchema),
    async (c) => {
      const { db, now } = c.var.deps;
      const ctx = actorContext(c);
      const user = await withTransaction(db, (tx) =>
        updateStaffUser(tx, ctx, c.req.valid('param').id, c.req.valid('json'), now()),
      );
      return c.json(user);
    },
  );

  app.post(
    '/users/:id/totp-reset',
    validate('param', idParam),
    validate('json', deleteWithJustificationSchema),
    async (c) => {
      const { db, now } = c.var.deps;
      const ctx = actorContext(c);
      await withTransaction(db, (tx) =>
        resetStaffTotp(tx, ctx, c.req.valid('param').id, c.req.valid('json').justification, now()),
      );
      return c.body(null, 204);
    },
  );
  return app;
}
