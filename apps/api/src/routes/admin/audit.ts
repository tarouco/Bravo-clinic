import { auditQuerySchema } from '@bravo/core';
import { Hono } from 'hono';
import { validate } from '../../middleware/validate';
import { listAuditLog } from '../../modules/audit/audit-query.service';
import type { AppEnv } from '../../types';

/** `GET /admin/audit` (GES-115); `adminRoutes` limits it to admins. */
export function adminAuditRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.get('/audit', validate('query', auditQuerySchema), async (c) =>
    c.json(await listAuditLog(c.var.deps.db, c.req.valid('query'))),
  );
  return app;
}
