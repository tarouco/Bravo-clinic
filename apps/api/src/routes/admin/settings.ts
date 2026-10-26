import { policySettingsUpdateSchema } from '@bravo/core';
import { Hono } from 'hono';
import { withTransaction } from '../../db/client';
import { actorContext } from '../../lib/request-meta';
import { requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { getPolicySettings, updatePolicies } from '../../modules/settings/policies.service';
import type { AppEnv } from '../../types';

/** `GET/PUT /admin/settings/policies`: admin only (NUC-172..NUC-174). */
export function adminSettingsRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.get('/settings/policies', requireRole('admin'), async (c) =>
    c.json(await getPolicySettings(c.var.deps.db)),
  );
  app.put(
    '/settings/policies',
    requireRole('admin'),
    validate('json', policySettingsUpdateSchema),
    async (c) => {
      const ctx = actorContext(c);
      return c.json(
        await withTransaction(c.var.deps.db, (tx) => updatePolicies(tx, c.req.valid('json'), ctx)),
      );
    },
  );
  return app;
}
