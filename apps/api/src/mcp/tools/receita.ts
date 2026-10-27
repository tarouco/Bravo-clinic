import {
  adminCancelInput,
  adminSaleInput,
  couponInput,
  couponToggleInput,
  idSchema,
  manualCreditInput,
  packageTypeSchema,
  slotDiscountInput,
  subscriptionStatusSchema,
} from '@bravo/core';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { withTransaction } from '../../db/client';
import { bookingCategories, rooms, slotDiscounts, users } from '../../db/schema';
import { audit } from '../../lib/audit';
import { notFound } from '../../lib/errors';
import { flushAfterCommit, newAfterCommit } from '../../modules/booking/effects';
import { createCoupon, listCoupons, setCouponEnabled } from '../../modules/coupons/coupons.service';
import { grantCredit, toCreditLotView } from '../../modules/credits/credits.service';
import { applyDiscount, removeDiscount } from '../../modules/slot-discounts/slot-discounts.service';
import {
  findSubscription,
  listAdminSubscriptions,
} from '../../modules/subscriptions/admin-queries.service';
import { cancelPreview, cancelSubscription } from '../../modules/subscriptions/cancel.service';
import { sellSubscription } from '../../modules/subscriptions/purchase.service';
import { toSubscriptionView } from '../../modules/subscriptions/views.service';
import { defineTool, type ToolDefinition } from '../server';

// receita tools of design "MCP tool catalog" (R10), on the same services as the Admin routes.

export function receitaTools(): ToolDefinition[] {
  return [
    defineTool({
      name: 'slot_discount_apply',
      description: 'Aplica um desconto percentual a um horário de uma ou mais salas.',
      scope: 'write',
      input: slotDiscountInput,
      run: (tc, input) =>
        withTransaction(tc.deps.db, (tx) => applyDiscount(tx, tc.ctx, input, tc.deps.now())),
    }),
    defineTool({
      name: 'slot_discount_remove',
      description: 'Remove um desconto de horário. Exige confirm: true.',
      scope: 'write',
      destructive: true,
      input: z.object({ id: idSchema }),
      preview: async (tc, input) => {
        const [row] = await tc.deps.db
          .select({ percent: slotDiscounts.percent, room: rooms.name })
          .from(slotDiscounts)
          .innerJoin(rooms, eq(rooms.id, slotDiscounts.roomId))
          .where(and(eq(slotDiscounts.id, input.id), isNull(slotDiscounts.removedAt)));
        if (row === undefined) throw notFound('NOT_FOUND', 'Desconto não encontrado');
        return `Remover o desconto de ${String(row.percent)}% da ${row.room}; o horário volta ao preço normal.`;
      },
      run: async (tc, input) => {
        await withTransaction(tc.deps.db, (tx) =>
          removeDiscount(tx, tc.ctx, input.id, tc.deps.now()),
        );
        return { removed: true };
      },
    }),
    defineTool({
      name: 'subscriptions_list',
      description:
        'Lista assinaturas (pacotes de horas e horários fixos) por status, tipo ou busca.',
      scope: 'read',
      input: z.object({
        status: subscriptionStatusSchema.optional(),
        type: packageTypeSchema.optional(),
        search: z.string().max(100).optional(),
        cursor: z.string().min(1).optional(),
      }),
      run: (tc, { cursor, ...filters }) => listAdminSubscriptions(tc.deps.db, filters, cursor),
    }),
    defineTool({
      name: 'subscription_sell',
      description:
        'Vende um pacote ou horário fixo a um cliente (userId), por link de pagamento ou pagamento registrado.',
      scope: 'write',
      input: adminSaleInput,
      run: async (tc, input) => {
        const { subscriptionId } = await sellSubscription(tc.deps, tc.ctx, input);
        const subscription = await findSubscription(tc.deps.db, subscriptionId);
        return {
          subscription: await toSubscriptionView(tc.deps.db, subscription, tc.deps.now()),
        };
      },
    }),
    defineTool({
      name: 'subscription_cancel',
      description: 'Cancela uma assinatura com justificativa. Exige confirm: true.',
      scope: 'write',
      destructive: true,
      input: z.object({ subscriptionId: idSchema }).extend(adminCancelInput.shape),
      preview: async (tc, input) => {
        const subscription = await findSubscription(tc.deps.db, input.subscriptionId);
        const [names] = await tc.deps.db
          .select({ category: bookingCategories.name, customer: users.name })
          .from(bookingCategories)
          .innerJoin(users, eq(users.id, subscription.userId))
          .where(eq(bookingCategories.id, subscription.categoryId));
        const p = await cancelPreview(tc.deps.db, subscription, tc.deps.now());
        const occurrences =
          'occurrencesReleased' in p
            ? ` ${String(p.occurrencesReleased)} ocorrência(s) futura(s) serão liberadas.`
            : '';
        return `Cancelar a assinatura "${names?.category ?? ''}" de ${names?.customer ?? 'cliente'}.${occurrences} Minutos extras mantidos: ${String(p.extraMinutesKept)}.`;
      },
      run: async (tc, input) => {
        const fx = newAfterCommit();
        const now = tc.deps.now();
        const subscription = await findSubscription(tc.deps.db, input.subscriptionId);
        const cancelled = await withTransaction(tc.deps.db, (tx) =>
          cancelSubscription(tx, tc.ctx, subscription.id, {
            actor: 'admin',
            justification: input.justification,
            now,
            appBaseUrl: tc.deps.env.APP_BASE_URL,
            fx,
          }),
        );
        await flushAfterCommit(tc.deps, fx, tc.ctx);
        return { subscription: await toSubscriptionView(tc.deps.db, cancelled, now) };
      },
    }),
    defineTool({
      name: 'coupons_list',
      description: 'Lista os cupons cadastrados com tipo, valor, validade e situação.',
      scope: 'read',
      input: z.object({}),
      run: async (tc) => ({ items: await listCoupons(tc.deps.db) }),
    }),
    defineTool({
      name: 'coupon_create',
      description: 'Cria um cupom de desconto (percentual ou valor fixo).',
      scope: 'write',
      input: couponInput,
      run: (tc, input) =>
        withTransaction(tc.deps.db, (tx) => createCoupon(tx, tc.ctx, input, tc.deps.now())),
    }),
    defineTool({
      name: 'coupon_set_enabled',
      description: 'Ativa ou desativa um cupom.',
      scope: 'write',
      input: z.object({ couponId: idSchema }).extend(couponToggleInput.shape),
      run: (tc, input) =>
        withTransaction(tc.deps.db, (tx) =>
          setCouponEnabled(tx, tc.ctx, input.couponId, input.enabled, tc.deps.now()),
        ),
    }),
    defineTool({
      name: 'credit_grant',
      description: 'Concede crédito manual a um cliente (userId), com justificativa.',
      scope: 'write',
      input: z.object({ userId: idSchema }).extend(manualCreditInput.shape),
      run: async (tc, input) => {
        const [user] = await tc.deps.db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, input.userId));
        if (user === undefined) throw notFound('NOT_FOUND', 'Cliente não encontrado');
        const lot = await withTransaction(tc.deps.db, async (tx) => {
          const created = await grantCredit(tx, tc.ctx, {
            userId: input.userId,
            amountCents: input.amountCents,
            source: 'manual',
            justification: input.justification,
            refType: 'user',
            refId: input.userId,
            now: tc.deps.now(),
          });
          await audit(tx, tc.ctx, {
            action: 'credit.grant_manual',
            entityType: 'credit_lot',
            entityId: created.id,
            justification: input.justification,
            after: {
              userId: input.userId,
              amountCents: created.amountCents,
              expiresAt: created.expiresAt,
            },
          });
          return created;
        });
        return { lot: toCreditLotView(lot) };
      },
    }),
  ];
}
