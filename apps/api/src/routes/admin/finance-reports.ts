import { financeQuerySchema } from '@bravo/core';
import { Hono } from 'hono';
import { validate } from '../../middleware/validate';
import { XLSX_CONTENT_TYPE, dreFileName, renderDreXlsx } from '../../modules/finance/dre-xlsx';
import { buildDreMatrix, buildSummary } from '../../modules/finance/finance-report.service';
import type { AppEnv } from '../../types';

/** Financeiro reports (GES-22..GES-25, GES-29..GES-34); `adminRoutes` limits `/finance/*` to admins. */
export function adminFinanceReportRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/finance/summary', validate('query', financeQuerySchema), async (c) =>
    c.json(await buildSummary(c.var.deps.db, c.req.valid('query'))),
  );

  // The grouping of the shared query is ignored: the DRE always has one column per month.
  app.get('/finance/dre.xlsx', validate('query', financeQuerySchema), async (c) => {
    const { db, now } = c.var.deps;
    const { from, to, regime } = c.req.valid('query');
    const matrix = await buildDreMatrix(db, { from, to, regime });
    const bytes = await renderDreXlsx(matrix, { from, to, regime, generatedAt: now() });
    return c.body(bytes, 200, {
      'Content-Type': XLSX_CONTENT_TYPE,
      'Content-Disposition': `attachment; filename="${dreFileName({ from, to, regime })}"`,
    });
  });
  return app;
}
