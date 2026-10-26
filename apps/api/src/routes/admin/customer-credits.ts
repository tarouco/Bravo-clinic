import { idSchema, manualCreditInput } from '@bravo/core';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { withTransaction, type Db } from '../../db/client';
import { users } from '../../db/schema';
import { audit } from '../../lib/audit';
import { notFound } from '../../lib/errors';
import { idempotent } from '../../lib/idempotency';
import { actorContext } from '../../lib/request-meta';
import { requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { grantCredit, listCredits, toCreditLotView } from '../../modules/credits/credits.service';
import type { AppEnv } from '../../types';

const userParam = z.object({ userId: idSchema });

async function assertUser(db: Db, userId: string): Promise<void> {
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId));
  if (user === undefined) throw notFound('NOT_FOUND', 'Cliente não encontrado');
}

/** A customer's credits: staff read them; only the admin grants a manual credit (REC-112). */
export function adminCustomerCreditRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/customers/:userId/credits', validate('param', userParam), async (c) => {
    const { db, now } = c.var.deps;
    const { userId } = c.req.valid('param');
    await assertUser(db, userId);
    return c.json(await listCredits(db, userId, now()));
  });

  app.post(
    '/customers/:userId/credits',
    requireRole('admin'),
    validate('param', userParam),
    idempotent(),
    validate('json', manualCreditInput),
    async (c) => {
      const { db, now } = c.var.deps;
      const { userId } = c.req.valid('param');
      const input = c.req.valid('json');
      await assertUser(db, userId);
      const ctx = actorContext(c);
      const lot = await withTransaction(db, async (tx) => {
        const created = await grantCredit(tx, ctx, {
          userId,
          amountCents: input.amountCents,
          source: 'manual',
          justification: input.justification,
          refType: 'user',
          refId: userId,
          now: now(),
        });
        await audit(tx, ctx, {
          action: 'credit.grant_manual',
          entityType: 'credit_lot',
          entityId: created.id,
          justification: input.justification,
          after: { userId, amountCents: created.amountCents, expiresAt: created.expiresAt },
        });
        return created;
      });
      return c.json({ lot: toCreditLotView(lot) }, 201);
    },
  );

  return app;
}
