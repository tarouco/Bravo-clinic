import {
  addDays,
  chargeDueAt,
  periodBounds,
  periodDaysOf,
  type AdminSaleInput,
  type Cents,
  type LocalDate,
  type SettingsValues,
  type SubscriptionPurchaseInput,
} from '@bravo/core';
import { eq } from 'drizzle-orm';
import type { Tx } from '../../db/client';
import {
  bookingCategories,
  consents,
  subscriptionPeriods,
  subscriptions,
  users,
} from '../../db/schema';
import type { ChargeRow } from '../../extensions/registry';
import { audit, type RequestContext } from '../../lib/audit';
import {
  AppError,
  conflict,
  notFound,
  uniqueViolationConstraint,
  validationFailed,
} from '../../lib/errors';
import type { RequestMeta } from '../../lib/request-meta';
import { newAfterCommit, flushAfterCommit, type AfterCommit } from '../booking/effects';
import { couponInvalid, evaluateCoupon, reserveUse } from '../coupons/coupons.service';
import { applyCredits } from '../credits/credits.service';
import { RECURRING_CONSENT_VERSION, listSavedCards } from '../payments/cards.service';
import {
  createCharge,
  submitCharge,
  type PayMethod,
  type PaymentDeps,
} from '../payments/charges.service';
import { activeProvider, resolveGatewayForCharge } from '../../payments/resolver';
import { loadBusinessHours, loadDayContexts } from '../calendar/calendar.repo';
import { addHoursToInstant } from '../revenue/instants';
import { loadSettings } from '../settings/settings.repo';
import { activateSubscription } from './activation.service';
import { insertOccurrences, occurrenceConflict } from './occurrences.service';
import {
  assertBaseOn,
  loadPackageCategory,
  planFixedPeriod,
  quoteSubscription,
} from './quote.service';
import { revenueMailer } from './revenue-mailer';
import type { SubscriptionRow } from './transitions';

// Buying a subscription (REC-12..REC-15, REC-21, REC-85..REC-87, REC-115, REC-125) and the admin
// sale (REC-150..REC-152). Everything is written in one transaction; the gateway is called after
// commit with the persisted `pending` charge.

type CategoryRow = typeof bookingCategories.$inferSelect;
type PackagePeriod = 'monthly' | 'bimonthly' | 'quarterly';

export const SUBSCRIPTION_TERMS_VERSION = 'subscription-terms-2026-10';
const LIVE_STATUSES = ['awaiting_payment', 'active', 'suspended'];

const hasHourPackage = () =>
  conflict('CONFLICT', 'Você já tem um pacote de horas. Use “Trocar pacote” em Compras.');

/** The `price_snapshot` of a category's current terms. */
export function snapshotOf(category: CategoryRow): Record<string, unknown> {
  return category.type === 'hour_package'
    ? {
        categoryVersion: category.version,
        priceCents: category.fixedPriceCents,
        includedMinutes: category.includedMinutes,
      }
    : {
        categoryVersion: category.version,
        pricePerOccurrenceCents: category.pricePerOccurrenceCents,
        weekdays: category.weekdays,
        startMinute: category.startMinute,
        endMinute: category.endMinute,
      };
}

/** REC-21: the user's own, live card with recurring consent from the active gateway. */
export async function assertRecurringCard(
  tx: Tx,
  userId: string,
  savedCardId: string | undefined,
): Promise<string> {
  const reject = () =>
    validationFailed([
      {
        path: ['savedCardId'],
        message: 'Escolha um cartão salvo válido para cobranças recorrentes',
      },
    ]);
  if (savedCardId === undefined) throw reject();
  const card = (await listSavedCards(tx, userId)).find((c) => c.id === savedCardId);
  if (card === undefined || card.recurringConsentAt === null) throw reject();
  if (card.provider !== (await activeProvider(tx))) throw reject();
  return card.id;
}

/** REC-12: at most one live hour package per user; the user row lock serializes purchases. */
export async function assertNoHourPackage(tx: Tx, userId: string): Promise<void> {
  await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');
  const live = await tx
    .select({ id: subscriptions.id, type: subscriptions.type, status: subscriptions.status })
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId));
  if (live.some((s) => s.type === 'hour_package' && LIVE_STATUSES.includes(s.status))) {
    throw hasHourPackage();
  }
}

export interface NewSubscription {
  subscription: SubscriptionRow;
  period: typeof subscriptionPeriods.$inferSelect;
}

/** Inserts the subscription and its first period `awaiting_payment` (REC-14). */
export async function insertSubscription(
  tx: Tx,
  ctx: RequestContext,
  args: {
    userId: string;
    category: CategoryRow;
    baseOn: LocalDate;
    roomId: string | null;
    priceCents: Cents;
    discountCents: Cents;
    occurrenceCount: number | null;
    holdExpiresAt: Date | null;
    paymentMethod: 'saved_card' | 'pix';
    savedCardId: string | null;
    firstCouponId: string | null;
    saleMode: 'self' | 'link' | 'manual';
    source: 'web' | 'app' | 'admin' | 'mcp';
    settings: SettingsValues;
    now: Date;
    switchFromSubscriptionId?: string | null;
  },
): Promise<NewSubscription> {
  const periodDays = periodDaysOf(args.category.period as PackagePeriod);
  const snapshot = snapshotOf(args.category);
  let subscription: SubscriptionRow | undefined;
  try {
    [subscription] = await tx
      .insert(subscriptions)
      .values({
        userId: args.userId,
        categoryId: args.category.id,
        type: args.category.type,
        roomId: args.roomId,
        status: 'awaiting_payment',
        baseOn: args.baseOn,
        periodDays,
        priceSnapshot: snapshot,
        paymentMethod: args.paymentMethod,
        savedCardId: args.savedCardId,
        firstCouponId: args.firstCouponId,
        holdExpiresAt: args.holdExpiresAt,
        saleMode: args.saleMode,
        source: args.source,
        createdBy: ctx.actorUserId,
        switchFromSubscriptionId: args.switchFromSubscriptionId ?? null,
        createdAt: args.now,
        updatedAt: args.now,
      })
      .returning();
  } catch (error) {
    if (uniqueViolationConstraint(error) === 'subscriptions_one_hour_pkg') throw hasHourPackage();
    throw error;
  }
  if (subscription === undefined) throw new Error('insertSubscription: no row');
  const { startsOn, endsOn } = periodBounds(args.baseOn, periodDays);
  const isHour = args.category.type === 'hour_package';
  const [period] = await tx
    .insert(subscriptionPeriods)
    .values({
      subscriptionId: subscription.id,
      seq: 1,
      startsOn,
      endsOn,
      priceCents: args.priceCents,
      discountCents: args.discountCents,
      occurrenceCount: args.occurrenceCount,
      includedMinutes: isHour ? args.category.includedMinutes : null,
      minutesBalance: isHour ? 0 : null,
      priceSnapshot: snapshot,
      status: 'awaiting_payment',
      chargeDueAt: chargeDueAt(startsOn, args.settings['payment.subscription_renewal_days_before']),
      createdAt: args.now,
      updatedAt: args.now,
    })
    .returning();
  if (period === undefined) throw new Error('insertSubscription: no period row');
  return { subscription, period };
}

/** The fixed occurrences of the first period, or 409 with every conflicting date (REC-85). */
async function planOccurrences(
  tx: Tx,
  category: CategoryRow,
  roomId: string,
  baseOn: LocalDate,
  settings: SettingsValues,
  now: Date,
) {
  const periodDays = periodDaysOf(category.period as PackagePeriod);
  const dates = Array.from({ length: periodDays }, (_, i) => addDays(baseOn, i));
  const contexts = await loadDayContexts(tx, { roomId, dates, now });
  const plan = planFixedPeriod(category, roomId, baseOn, contexts, {
    cleanupMinutes: settings['calendar.cleanup_minutes'],
    notBefore: new Date(now.getTime() + settings['calendar.min_advance_minutes'] * 60_000),
    hours: await loadBusinessHours(tx),
  });
  if (plan.conflicts.length > 0) throw occurrenceConflict(plan.conflicts);
  return plan;
}

async function writeConsents(
  tx: Tx,
  userId: string,
  subscriptionId: string,
  meta: Pick<RequestMeta, 'ip' | 'userAgent'>,
  now: Date,
) {
  await tx.insert(consents).values(
    [
      { kind: 'subscription_terms', version: SUBSCRIPTION_TERMS_VERSION },
      { kind: 'recurring_charge', version: RECURRING_CONSENT_VERSION },
    ].map((c) => ({
      ...c,
      userId,
      acceptedAt: now,
      ip: meta.ip,
      userAgent: meta.userAgent,
      refType: 'subscription',
      refId: subscriptionId,
    })),
  );
}

export interface PurchaseResult {
  subscriptionId: string;
  charge: ChargeRow | null;
}

/** REC-13: both consents must be accepted; checked before the body schema. */
export function assertConsents(body: unknown): void {
  const b = body as { acceptTerms?: unknown; acceptRecurring?: unknown } | null;
  if (b?.acceptTerms !== true || b.acceptRecurring !== true) {
    throw new AppError(
      422,
      'POLICY_VIOLATION',
      'Aceite os termos da assinatura e autorize a cobrança recorrente para continuar',
    );
  }
}

/**
 * Tenant purchase (REC-12..REC-15, REC-21, REC-85..REC-87): subscription + period seq 1
 * `awaiting_payment` held for `payment.checkout_hold_minutes`, consents, the coupon use reserved,
 * credits applied and a `pending` `subscription_initial` charge for the rest; nothing to pay
 * activates at once. The charge is submitted to the gateway after commit.
 */
export async function purchaseSubscription(
  deps: PaymentDeps,
  ctx: RequestContext,
  meta: Pick<RequestMeta, 'ip' | 'userAgent'>,
  input: { userId: string; body: SubscriptionPurchaseInput; source: 'web' | 'app' | 'mcp' },
): Promise<PurchaseResult> {
  assertConsents(input.body);
  const now = deps.now();
  const { body } = input;
  const method: PayMethod = body.paymentMethod;
  const [payer] = await deps.db
    .select({ docNumber: users.docNumber })
    .from(users)
    .where(eq(users.id, input.userId));
  if (payer === undefined) throw notFound();
  await assertGatewayReady(deps, method);
  const fx = newAfterCommit();
  const result = await deps.db.transaction(async (tx) => {
    const settings = await loadSettings(tx);
    const category = await loadPackageCategory(tx, body.categoryId);
    assertBaseOn(body.baseOn, now, settings['calendar.max_advance_days']);
    if (category.type === 'hour_package') await assertNoHourPackage(tx, input.userId);
    const savedCardId =
      method === 'saved_card'
        ? await assertRecurringCard(tx, input.userId, body.savedCardId)
        : null;
    const quote = await quoteSubscription(tx, { userId: input.userId, input: body, now });
    if (quote.couponRejection !== undefined) throw couponInvalid(quote.couponRejection.reason);
    const coupon =
      body.couponCode === undefined
        ? null
        : await evaluateCoupon(tx, {
            code: body.couponCode,
            userId: input.userId,
            target: 'package',
            grossCents: quote.priceCents,
            now,
          });
    const roomId = category.type === 'fixed_schedule' ? (body.roomId ?? null) : null;
    const plan =
      roomId === null
        ? null
        : await planOccurrences(tx, category, roomId, body.baseOn, settings, now);
    const hold = addHoursToInstant(now, settings['payment.checkout_hold_minutes'] / 60);
    const created = await insertSubscription(tx, ctx, {
      userId: input.userId,
      category,
      baseOn: body.baseOn,
      roomId,
      priceCents: quote.priceCents,
      discountCents: quote.discountCents,
      occurrenceCount: plan?.occurrences.length ?? null,
      holdExpiresAt: hold,
      paymentMethod: savedCardId === null ? 'pix' : 'saved_card',
      savedCardId,
      firstCouponId: coupon?.ok === true ? coupon.coupon.id : null,
      saleMode: 'self',
      source: input.source,
      settings,
      now,
    });
    const { subscription, period } = created;
    await writeConsents(tx, input.userId, subscription.id, meta, now);
    if (coupon?.ok === true && coupon.discountCents > 0) {
      await reserveUse(tx, {
        couponId: coupon.coupon.id,
        userId: input.userId,
        discountCents: coupon.discountCents,
        subscriptionId: subscription.id,
        now,
      });
    }
    if (plan !== null && roomId !== null) {
      await insertOccurrences(tx, ctx, {
        userId: input.userId,
        roomId,
        subscriptionId: subscription.id,
        periodId: period.id,
        status: 'awaiting_payment',
        holdExpiresAt: hold,
        source: input.source,
        settings,
        occurrences: plan.occurrences,
      });
    }
    const payable = quote.priceCents - quote.discountCents;
    const credit =
      body.useCredits === true
        ? await applyCredits(tx, ctx, {
            userId: input.userId,
            amountCents: payable,
            purpose: 'subscription_initial',
            periodId: period.id,
            now,
          })
        : { usedCents: 0, chargeId: null };
    const payNow = payable - credit.usedCents;
    if (payNow === 0) {
      await activateSubscription(tx, ctx, subscription.id, {
        now,
        appBaseUrl: deps.env.APP_BASE_URL,
        fx,
      });
      return { subscriptionId: subscription.id, charge: null, categoryName: category.name };
    }
    if (method !== 'saved_card' && payer.docNumber === null) {
      throw new AppError(
        422,
        'PROFILE_INCOMPLETE',
        'Complete seu cadastro com CPF ou CNPJ para assinar.',
      );
    }
    const charge = await createCharge(tx, ctx, {
      purpose: 'subscription_initial',
      userId: input.userId,
      amountCents: payNow,
      method,
      ...(savedCardId !== null && { savedCardId }),
      expiresAt: hold,
      subscriptionPeriodId: period.id,
    });
    return { subscriptionId: subscription.id, charge, categoryName: category.name };
  });
  await flushAfterCommit(deps, fx, ctx);
  if (result.charge === null) return { subscriptionId: result.subscriptionId, charge: null };
  const submitted = await submitCharge(deps, result.charge.id, {
    description: `Assinatura ${result.categoryName}`,
    returnUrl: '/app/compras',
  });
  return { subscriptionId: result.subscriptionId, charge: submitted };
}

/** Raises 503 before any write when the active gateway cannot take a charge (NUC-125). */
export async function assertGatewayReady(deps: PaymentDeps, method: PayMethod): Promise<void> {
  if (method !== 'saved_card') await resolveGatewayForCharge(deps);
}

/**
 * Admin sale (REC-150..REC-152): `link` holds the subscription (and fixed occurrences as
 * `pre_reserved`) for 1..720 h and e-mails `subscription.sale_link`; `manual` activates it at once
 * without a charge and audits `subscription.confirm_manual`.
 */
export async function sellSubscription(
  deps: PaymentDeps,
  ctx: RequestContext,
  input: AdminSaleInput,
): Promise<PurchaseResult> {
  const now = deps.now();
  const fx: AfterCommit = newAfterCommit();
  const subscriptionId = await deps.db.transaction(async (tx) => {
    const [customer] = await tx.select().from(users).where(eq(users.id, input.userId));
    if (customer === undefined || customer.role !== 'tenant') {
      throw notFound('NOT_FOUND', 'Cliente não encontrado');
    }
    const settings = await loadSettings(tx);
    const category = await loadPackageCategory(tx, input.categoryId, { includeAdminOnly: true });
    assertBaseOn(input.baseOn, now, settings['calendar.max_advance_days']);
    if (category.type === 'hour_package') await assertNoHourPackage(tx, input.userId);
    const quote = await quoteSubscription(tx, {
      userId: input.userId,
      input: {
        categoryId: input.categoryId,
        baseOn: input.baseOn,
        ...(input.roomId !== undefined && { roomId: input.roomId }),
        ...(input.couponCode !== undefined && { couponCode: input.couponCode }),
      },
      now,
      includeAdminOnly: true,
    });
    if (quote.couponRejection !== undefined) throw couponInvalid(quote.couponRejection.reason);
    const coupon =
      input.couponCode === undefined
        ? null
        : await evaluateCoupon(tx, {
            code: input.couponCode,
            userId: input.userId,
            target: 'package',
            grossCents: quote.priceCents,
            now,
          });
    const roomId = category.type === 'fixed_schedule' ? (input.roomId ?? null) : null;
    const plan =
      roomId === null
        ? null
        : await planOccurrences(tx, category, roomId, input.baseOn, settings, now);
    const link = input.payment.mode === 'link';
    const hold = link
      ? addHoursToInstant(
          now,
          (input.payment.mode === 'link' ? input.payment.holdHours : undefined) ??
            settings['payment.pre_reservation_expiry_hours'],
        )
      : null;
    const { subscription, period } = await insertSubscription(tx, ctx, {
      userId: input.userId,
      category,
      baseOn: input.baseOn,
      roomId,
      priceCents: quote.priceCents,
      discountCents: quote.discountCents,
      occurrenceCount: plan?.occurrences.length ?? null,
      holdExpiresAt: hold,
      paymentMethod: 'pix',
      savedCardId: null,
      firstCouponId: coupon?.ok === true ? coupon.coupon.id : null,
      saleMode: input.payment.mode,
      source: 'admin',
      settings,
      now,
    });
    if (coupon?.ok === true && coupon.discountCents > 0) {
      await reserveUse(tx, {
        couponId: coupon.coupon.id,
        userId: input.userId,
        discountCents: coupon.discountCents,
        subscriptionId: subscription.id,
        now,
      });
    }
    if (plan !== null && roomId !== null) {
      await insertOccurrences(tx, ctx, {
        userId: input.userId,
        roomId,
        subscriptionId: subscription.id,
        periodId: period.id,
        status: link ? 'pre_reserved' : 'awaiting_payment',
        holdExpiresAt: hold,
        source: 'admin',
        settings,
        occurrences: plan.occurrences,
      });
    }
    if (input.payment.mode === 'manual') {
      await audit(tx, ctx, {
        action: 'subscription.confirm_manual',
        entityType: 'subscription',
        entityId: subscription.id,
        justification: input.payment.justification,
        after: { categoryId: category.id, priceCents: quote.priceCents },
      });
      await activateSubscription(tx, ctx, subscription.id, {
        now,
        appBaseUrl: deps.env.APP_BASE_URL,
        fx,
      });
    } else if (hold !== null) {
      fx.emailIds.push(
        await queueSaleLink(tx, subscription, {
          categoryName: category.name,
          amountCents: quote.priceCents - quote.discountCents,
          holdExpiresAt: hold,
          appBaseUrl: deps.env.APP_BASE_URL,
          attempt: 1,
        }),
      );
    }
    return subscription.id;
  });
  await flushAfterCommit(deps, fx, ctx);
  return { subscriptionId, charge: null };
}

/** `subscription.sale_link` to `/app/compras/assinaturas/{id}/pagar` (REC-151, REC-154). */
export async function queueSaleLink(
  tx: Tx,
  subscription: SubscriptionRow,
  args: {
    categoryName: string;
    amountCents: Cents;
    holdExpiresAt: Date;
    appBaseUrl: string;
    attempt: number;
  },
): Promise<string> {
  const [user] = await tx
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, subscription.userId));
  if (user === undefined) throw notFound();
  return revenueMailer['subscription.sale_link'](
    tx,
    { to: user.email, dedupeKey: `sale_link:${subscription.id}:${String(args.attempt)}` },
    {
      name: user.name,
      categoryName: args.categoryName,
      link: new URL(
        `/app/compras/assinaturas/${subscription.id}/pagar`,
        args.appBaseUrl,
      ).toString(),
      amountCents: args.amountCents,
      holdExpiresAt: args.holdExpiresAt,
    },
  );
}
