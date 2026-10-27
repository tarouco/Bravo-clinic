import {
  cancelInput,
  idSchema,
  payInput,
  subscriptionPurchaseInput,
  subscriptionQuoteInput,
  switchInput,
  switchQuoteInput,
} from '@bravo/core';
import { Hono, type MiddlewareHandler } from 'hono';
import { z } from 'zod';
import { withTransaction } from '../../db/client';
import { idempotent } from '../../lib/idempotency';
import { actorContext, requestMeta } from '../../lib/request-meta';
import { validate } from '../../middleware/validate';
import { flushAfterCommit, newAfterCommit } from '../../modules/booking/effects';
import { chargeIntentOf } from '../../modules/payments/charges.service';
import {
  cancelPreview,
  cancelSubscription,
  payPending,
} from '../../modules/subscriptions/cancel.service';
import { assertConsents, purchaseSubscription } from '../../modules/subscriptions/purchase.service';
import { quoteSubscription } from '../../modules/subscriptions/quote.service';
import { quoteSwitch, startSwitch } from '../../modules/subscriptions/switch.service';
import { ownedSubscription } from '../../modules/subscriptions/transitions';
import {
  listSubscriptionViews,
  subscriptionLedger,
  toSubscriptionView,
} from '../../modules/subscriptions/views.service';
import type { AppEnv } from '../../types';

const idParam = z.object({ id: idSchema });
const cursorQuery = z.object({ cursor: z.string().min(1).optional() });

/** REC-13: the consents are a policy check (422 POLICY_VIOLATION) before the body schema. */
const requireConsents: MiddlewareHandler<AppEnv> = async (c, next) => {
  assertConsents(await c.req.json().catch(() => null));
  await next();
};

/** Perfil → Compras: subscriptions of the signed-in tenant (design.md routes, REC-14, REC-20). */
export function subscriptionRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post('/subscriptions/quote', validate('json', subscriptionQuoteInput), async (c) => {
    const { db, now } = c.var.deps;
    return c.json(
      await quoteSubscription(db, {
        userId: c.get('auth').userId,
        input: c.req.valid('json'),
        now: now(),
      }),
    );
  });

  app.post(
    '/subscriptions',
    idempotent(),
    requireConsents,
    validate('json', subscriptionPurchaseInput),
    async (c) => {
      const deps = c.var.deps;
      const userId = c.get('auth').userId;
      const { subscriptionId, charge } = await purchaseSubscription(
        deps,
        actorContext(c),
        requestMeta(c),
        { userId, body: c.req.valid('json'), source: 'app' },
      );
      const subscription = await ownedSubscription(deps.db, userId, subscriptionId);
      return c.json(
        {
          subscription: await toSubscriptionView(deps.db, subscription, deps.now()),
          charge: charge === null ? null : chargeIntentOf(charge),
        },
        201,
      );
    },
  );

  app.get('/subscriptions', async (c) => {
    const { db, now } = c.var.deps;
    return c.json({ items: await listSubscriptionViews(db, c.get('auth').userId, now()) });
  });

  app.get('/subscriptions/:id', validate('param', idParam), async (c) => {
    const { db, now } = c.var.deps;
    const subscription = await ownedSubscription(db, c.get('auth').userId, c.req.valid('param').id);
    return c.json(await toSubscriptionView(db, subscription, now()));
  });

  app.get(
    '/subscriptions/:id/ledger',
    validate('param', idParam),
    validate('query', cursorQuery),
    async (c) => {
      const { db } = c.var.deps;
      const subscription = await ownedSubscription(
        db,
        c.get('auth').userId,
        c.req.valid('param').id,
      );
      return c.json(await subscriptionLedger(db, subscription, c.req.valid('query').cursor));
    },
  );

  app.post(
    '/subscriptions/:id/switch/quote',
    validate('param', idParam),
    validate('json', switchQuoteInput),
    async (c) => {
      const { db, now } = c.var.deps;
      return c.json(
        await quoteSwitch(db, {
          userId: c.get('auth').userId,
          subscriptionId: c.req.valid('param').id,
          input: c.req.valid('json'),
          now: now(),
        }),
      );
    },
  );

  app.post(
    '/subscriptions/:id/switch',
    validate('param', idParam),
    idempotent(),
    validate('json', switchInput),
    async (c) => {
      const deps = c.var.deps;
      const userId = c.get('auth').userId;
      const { subscriptionId, charge } = await startSwitch(deps, actorContext(c), {
        userId,
        subscriptionId: c.req.valid('param').id,
        body: c.req.valid('json'),
      });
      const subscription = await ownedSubscription(deps.db, userId, subscriptionId);
      return c.json(
        {
          subscription: await toSubscriptionView(deps.db, subscription, deps.now()),
          charge: charge === null ? null : chargeIntentOf(charge),
        },
        201,
      );
    },
  );

  app.get('/subscriptions/:id/cancel-preview', validate('param', idParam), async (c) => {
    const { db, now } = c.var.deps;
    const subscription = await ownedSubscription(db, c.get('auth').userId, c.req.valid('param').id);
    return c.json(await cancelPreview(db, subscription, now()));
  });

  app.post(
    '/subscriptions/:id/cancel',
    validate('param', idParam),
    validate('json', cancelInput),
    async (c) => {
      const deps = c.var.deps;
      const userId = c.get('auth').userId;
      const owned = await ownedSubscription(deps.db, userId, c.req.valid('param').id);
      const ctx = actorContext(c);
      const fx = newAfterCommit();
      const now = deps.now();
      const cancelled = await withTransaction(deps.db, (tx) =>
        cancelSubscription(tx, ctx, owned.id, {
          actor: 'tenant',
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
    '/subscriptions/:id/pay',
    validate('param', idParam),
    idempotent(),
    validate('json', payInput),
    async (c) => {
      const deps = c.var.deps;
      const userId = c.get('auth').userId;
      const { subscriptionId, charge } = await payPending(deps, actorContext(c), {
        userId,
        subscriptionId: c.req.valid('param').id,
        body: c.req.valid('json'),
      });
      const subscription = await ownedSubscription(deps.db, userId, subscriptionId);
      return c.json({
        charge: charge === null ? null : chargeIntentOf(charge),
        subscription: await toSubscriptionView(deps.db, subscription, deps.now()),
      });
    },
  );

  return app;
}
