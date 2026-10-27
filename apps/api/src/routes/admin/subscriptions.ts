import {
  adminCancelInput,
  adminSaleInput,
  balanceAdjustInput,
  idSchema,
  packageTypeSchema,
  subscriptionStatusSchema,
} from '@bravo/core';
import { and, eq, like } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { withTransaction } from '../../db/client';
import { emailOutbox, subscriptionPeriods } from '../../db/schema';
import { AppError, conflict } from '../../lib/errors';
import { idempotent } from '../../lib/idempotency';
import { actorContext } from '../../lib/request-meta';
import { requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { flushAfterCommit, newAfterCommit } from '../../modules/booking/effects';
import { adjustPeriod } from '../../modules/packages/minutes.service';
import {
  findSubscription,
  getAdminSubscription,
  listAdminSubscriptions,
} from '../../modules/subscriptions/admin-queries.service';
import { cancelSubscription } from '../../modules/subscriptions/cancel.service';
import { categoryName } from '../../modules/subscriptions/late-refund';
import { queueSaleLink, sellSubscription } from '../../modules/subscriptions/purchase.service';
import { quoteSubscription } from '../../modules/subscriptions/quote.service';
import {
  subscriptionLedger,
  toPeriodView,
  toSubscriptionView,
} from '../../modules/subscriptions/views.service';
import type { AppEnv } from '../../types';

const idParam = z.object({ id: idSchema });
const listQuery = z.object({
  status: subscriptionStatusSchema.optional(),
  type: packageTypeSchema.optional(),
  search: z.string().max(100).optional(),
  cursor: z.string().min(1).optional(),
});
const cursorQuery = z.object({ cursor: z.string().min(1).optional() });

/**
 * Gestão de Reservas → Assinaturas (REC-43..REC-45, REC-82, REC-148..REC-154): staff read the list,
 * detail and extrato; only the admin quotes, sells, cancels, adjusts and resends links.
 */
export function adminSubscriptionRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/subscriptions', validate('query', listQuery), async (c) => {
    const { cursor, ...filters } = c.req.valid('query');
    return c.json(await listAdminSubscriptions(c.var.deps.db, filters, cursor));
  });

  app.post(
    '/subscriptions/quote',
    requireRole('admin'),
    validate('json', adminSaleInput),
    async (c) => {
      const { db, now } = c.var.deps;
      const input = c.req.valid('json');
      return c.json(
        await quoteSubscription(db, {
          userId: input.userId,
          input: {
            categoryId: input.categoryId,
            baseOn: input.baseOn,
            ...(input.roomId !== undefined && { roomId: input.roomId }),
            ...(input.couponCode !== undefined && { couponCode: input.couponCode }),
          },
          now: now(),
          includeAdminOnly: true,
        }),
      );
    },
  );

  app.post(
    '/subscriptions',
    requireRole('admin'),
    idempotent(),
    validate('json', adminSaleInput),
    async (c) => {
      const deps = c.var.deps;
      const { subscriptionId } = await sellSubscription(deps, actorContext(c), c.req.valid('json'));
      const subscription = await findSubscription(deps.db, subscriptionId);
      return c.json(
        { subscription: await toSubscriptionView(deps.db, subscription, deps.now()), charge: null },
        201,
      );
    },
  );

  app.get('/subscriptions/:id', validate('param', idParam), async (c) => {
    const { db, now } = c.var.deps;
    return c.json(await getAdminSubscription(db, c.req.valid('param').id, now()));
  });

  app.get(
    '/subscriptions/:id/ledger',
    validate('param', idParam),
    validate('query', cursorQuery),
    async (c) => {
      const { db } = c.var.deps;
      const subscription = await findSubscription(db, c.req.valid('param').id);
      return c.json(await subscriptionLedger(db, subscription, c.req.valid('query').cursor));
    },
  );

  app.post(
    '/subscriptions/:id/cancel',
    requireRole('admin'),
    validate('param', idParam),
    validate('json', adminCancelInput),
    async (c) => {
      const deps = c.var.deps;
      const ctx = actorContext(c);
      const fx = newAfterCommit();
      const now = deps.now();
      const subscription = await findSubscription(deps.db, c.req.valid('param').id);
      const cancelled = await withTransaction(deps.db, (tx) =>
        cancelSubscription(tx, ctx, subscription.id, {
          actor: 'admin',
          justification: c.req.valid('json').justification,
          now,
          appBaseUrl: deps.env.APP_BASE_URL,
          fx,
        }),
      );
      await flushAfterCommit(deps, fx, ctx);
      return c.json({ subscription: await toSubscriptionView(deps.db, cancelled, now) });
    },
  );

  app.post(
    '/subscriptions/:id/adjust-balance',
    requireRole('admin'),
    validate('param', idParam),
    validate('json', balanceAdjustInput),
    async (c) => {
      const { db, now } = c.var.deps;
      const input = c.req.valid('json');
      const subscription = await findSubscription(db, c.req.valid('param').id);
      const [active] = await db
        .select({ id: subscriptionPeriods.id })
        .from(subscriptionPeriods)
        .where(
          and(
            eq(subscriptionPeriods.subscriptionId, subscription.id),
            eq(subscriptionPeriods.status, 'active'),
          ),
        );
      if (subscription.type !== 'hour_package' || active === undefined) {
        throw conflict(
          'INVALID_TRANSITION',
          'Só o período ativo de um pacote de horas pode ser ajustado',
        );
      }
      const ctx = actorContext(c);
      const period = await withTransaction(db, (tx) =>
        adjustPeriod(tx, ctx, {
          periodId: active.id,
          minutes: input.minutes,
          justification: input.justification,
          now: now(),
        }),
      );
      return c.json({ period: toPeriodView(period) });
    },
  );

  app.post(
    '/subscriptions/:id/resend-link',
    requireRole('admin'),
    validate('param', idParam),
    async (c) => {
      const deps = c.var.deps;
      const subscription = await findSubscription(deps.db, c.req.valid('param').id);
      if (
        subscription.status !== 'awaiting_payment' ||
        subscription.saleMode !== 'link' ||
        subscription.holdExpiresAt === null
      ) {
        throw new AppError(409, 'INVALID_TRANSITION', 'Esta assinatura não aguarda pagamento');
      }
      const holdExpiresAt = subscription.holdExpiresAt;
      const emailId = await withTransaction(deps.db, async (tx) => {
        const sent = await tx
          .select({ id: emailOutbox.id })
          .from(emailOutbox)
          .where(like(emailOutbox.dedupeKey, `sale_link:${subscription.id}:%`));
        const [period] = await tx
          .select()
          .from(subscriptionPeriods)
          .where(eq(subscriptionPeriods.subscriptionId, subscription.id));
        return queueSaleLink(tx, subscription, {
          categoryName: await categoryName(tx, subscription),
          amountCents: (period?.priceCents ?? 0) - (period?.discountCents ?? 0),
          holdExpiresAt,
          appBaseUrl: deps.env.APP_BASE_URL,
          attempt: sent.length + 1,
        });
      });
      const fx = newAfterCommit();
      fx.emailIds.push(emailId);
      await flushAfterCommit(deps, fx, actorContext(c));
      return c.json({ queued: true });
    },
  );

  return app;
}
