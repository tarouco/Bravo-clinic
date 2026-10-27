import { financeQuerySchema } from '@bravo/core';
import { Hono } from 'hono';
import { validate } from '../../middleware/validate';
import { buildSummary } from '../../modules/finance/finance-report.service';
import type { AppEnv } from '../../types';

/** Financeiro reports (GES-22..GES-25); `adminRoutes` limits `/finance/*` to admins. */
export function adminFinanceReportRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/finance/summary', validate('query', financeQuerySchema), async (c) =>
    c.json(await buildSummary(c.var.deps.db, c.req.valid('query'))),
  );
  return app;
}
