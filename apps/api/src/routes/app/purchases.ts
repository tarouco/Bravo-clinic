import { extraHoursPurchaseInput } from '@bravo/core';
import { Hono } from 'hono';
import { z } from 'zod';
import { validationFailed } from '../../lib/errors';
import { idempotent } from '../../lib/idempotency';
import { actorContext } from '../../lib/request-meta';
import { validate } from '../../middleware/validate';
import { listCredits } from '../../modules/credits/credits.service';
import {
  extraHoursSummary,
  purchaseExtraHours,
  purchaseHistory,
  toPurchaseView,
} from '../../modules/extra-hours/extra-hours.service';
import { chargeIntentOf } from '../../modules/payments/charges.service';
import { loadSettings } from '../../modules/settings/settings.repo';
import type { AppEnv } from '../../types';

const cursorQuery = z.object({ cursor: z.string().min(1).optional() });

/** Perfil → Compras reads and the extra-hours purchase (REC-62..REC-66, REC-114, REC-145). */
export function purchaseRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/extra-hours', async (c) => {
    const { db, now } = c.var.deps;
    return c.json(await extraHoursSummary(db, c.get('auth').userId, now()));
  });

  app.post('/extra-hours', idempotent(), async (c) => {
    const deps = c.var.deps;
    const settings = await loadSettings(deps.db);
    const parsed = extraHoursPurchaseInput(
      settings['payment.extra_hours_min'],
      settings['payment.extra_hours_max'],
    ).safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw validationFailed(parsed.error.issues);
    const userId = c.get('auth').userId;
    const { purchase, charge } = await purchaseExtraHours(deps, actorContext(c), {
      userId,
      body: parsed.data,
    });
    return c.json(
      {
        purchase: toPurchaseView(purchase),
        charge: charge === null ? null : chargeIntentOf(charge),
      },
      201,
    );
  });

  app.get('/credits', async (c) => {
    const { db, now } = c.var.deps;
    return c.json(await listCredits(db, c.get('auth').userId, now()));
  });

  app.get('/purchases/history', validate('query', cursorQuery), async (c) => {
    const { db } = c.var.deps;
    return c.json(await purchaseHistory(db, c.get('auth').userId, c.req.valid('query').cursor));
  });

  return app;
}
