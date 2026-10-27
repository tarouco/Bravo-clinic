import {
  addDays,
  fixedPeriodPriceCents,
  graceEndsOn,
  type CancelPreview,
  type LocalDate,
  type PayInput,
} from '@bravo/core';
import { and, asc, eq, inArray, lte } from 'drizzle-orm';
import type { Db, Tx } from '../../db/client';
import { bookingCategories, charges, subscriptionPeriods, subscriptions } from '../../db/schema';
import type { ChargeRow } from '../../extensions/registry';
import { audit, type RequestContext } from '../../lib/audit';
import { AppError, conflict } from '../../lib/errors';
import { flushAfterCommit, newAfterCommit, type AfterCommit } from '../booking/effects';
import { loadBusinessHours, loadDayContexts } from '../calendar/calendar.repo';
import { applyCredits } from '../credits/credits.service';
import { extraMinutesAvailable } from '../packages/minutes.service';
import {
  cancelCharge,
  createCharge,
  submitCharge,
  type ChargePurpose,
  type PayMethod,
  type PaymentDeps,
} from '../payments/charges.service';
import { loadSettings } from '../settings/settings.repo';
import { activateSubscription } from './activation.service';
import { settleRenewal } from './charge-handlers';
import { categoryName } from './late-refund';
import {
  insertOccurrence,
  occurrencesOf,
  subscriberOf,
  transitionOccurrences,
} from './occurrences.service';
import { closePeriod, todayOf } from './period.service';
import { assertGatewayReady, assertRecurringCard } from './purchase.service';
import { planFixedPeriod } from './quote.service';
import { revenueMailer } from './revenue-mailer';
import {
  lockSubscription,
  ownedSubscription,
  transitionPeriod,
  transitionSubscription,
  type PeriodRow,
  type SubscriptionRow,
} from './transitions';

// Cancellation (REC-79..REC-82), suspension and end of grace (REC-54, REC-57) and payment of a
// pending period (REC-56): the first payment, a pending renewal, or the regularization of a
// suspended subscription.

const FUTURE_OCCURRENCES = ['awaiting_payment', 'pre_reserved', 'confirmed'] as const;

async function periodsIn(db: Db | Tx, subscriptionId: string, statuses: string[]) {
  return db
    .select()
    .from(subscriptionPeriods)
    .where(
      and(
        eq(subscriptionPeriods.subscriptionId, subscriptionId),
        inArray(subscriptionPeriods.status, statuses),
      ),
    )
    .orderBy(asc(subscriptionPeriods.seq));
}

/** `GET /app/subscriptions/:id/cancel-preview` (REC-79). */
export async function cancelPreview(
  db: Db | Tx,
  subscription: SubscriptionRow,
  now: Date,
): Promise<CancelPreview> {
  const extraMinutesKept = await extraMinutesAvailable(db, subscription.userId, now);
  if (subscription.type === 'fixed_schedule') {
    const future = (
      await occurrencesOf(db as Tx, subscription.id, [...FUTURE_OCCURRENCES, 'held_for_renewal'])
    ).filter((b) => b.status === 'held_for_renewal' || b.startsAt > now);
    return { occurrencesReleased: future.length, extraMinutesKept };
  }
  const [active] = await periodsIn(db, subscription.id, ['active']);
  const paid = await periodsIn(db, subscription.id, ['paid']);
  const lost = paid.reduce((sum, p) => sum + p.priceCents - p.discountCents, 0);
  return {
    minutesLost: active?.minutesBalance ?? 0,
    ...(lost > 0 && { paidUpcomingPeriodLostCents: lost }),
    extraMinutesKept,
  };
}

/** Cancels the pending charges of the given periods; returns them for the provider-side cancel. */
async function cancelPendingCharges(
  tx: Tx,
  ctx: RequestContext,
  periodIds: string[],
): Promise<ChargeRow[]> {
  if (periodIds.length === 0) return [];
  const pending = await tx
    .select({ id: charges.id })
    .from(charges)
    .where(and(inArray(charges.subscriptionPeriodId, periodIds), eq(charges.status, 'pending')));
  const out: ChargeRow[] = [];
  for (const { id } of pending) {
    const cancelled = await cancelCharge(tx, ctx, id);
    if (cancelled !== null) out.push(cancelled);
  }
  return out;
}

export interface CancelOptions {
  actor: 'tenant' | 'admin';
  justification?: string;
  now: Date;
  appBaseUrl: string;
  fx: AfterCommit;
}

/**
 * REC-80..REC-82: `cancelled` at once; the package minutes left expire, pending charges and every
 * future period are cancelled; package bookings already made stay valid. Fixed occurrences ahead
 * are released (`cancelled_by_tenant`, or `cancelled_by_clinic` when the admin cancels) and the held
 * ones expire. No refund. The admin's justification is audited as `subscription.cancel`.
 */
export async function cancelSubscription(
  tx: Tx,
  ctx: RequestContext,
  subscriptionId: string,
  opts: CancelOptions,
): Promise<SubscriptionRow> {
  const { now } = opts;
  const before = await lockSubscription(tx, subscriptionId);
  const preview = await cancelPreview(tx, before, now);
  const subscription = await transitionSubscription(
    tx,
    subscriptionId,
    ['active', 'suspended'],
    'cancelled',
    now,
    { cancelledAt: now, autoRenew: false },
  );
  for (const period of await periodsIn(tx, subscriptionId, ['active'])) {
    await closePeriod(tx, ctx, period.id, now);
  }
  const future = await periodsIn(tx, subscriptionId, ['upcoming', 'awaiting_payment', 'paid']);
  opts.fx.cancelCharges.push(
    ...(await cancelPendingCharges(
      tx,
      ctx,
      future.map((p) => p.id),
    )),
  );
  for (const period of future) {
    await transitionPeriod(
      tx,
      period.id,
      ['upcoming', 'awaiting_payment', 'paid'],
      'cancelled',
      now,
    );
  }
  if (subscription.type === 'fixed_schedule') {
    const own = await occurrencesOf(tx, subscriptionId, [
      ...FUTURE_OCCURRENCES,
      'held_for_renewal',
    ]);
    await transitionOccurrences(
      tx,
      ctx,
      own.filter((b) => b.status !== 'held_for_renewal' && b.startsAt > now),
      opts.actor === 'admin' ? 'cancelled_by_clinic' : 'cancelled_by_tenant',
      'subscription_cancelled',
      now,
    );
    await transitionOccurrences(
      tx,
      ctx,
      own.filter((b) => b.status === 'held_for_renewal'),
      'expired',
      'subscription_cancelled',
      now,
    );
  }
  if (opts.actor === 'admin') {
    await audit(tx, ctx, {
      action: 'subscription.cancel',
      entityType: 'subscription',
      entityId: subscriptionId,
      ...(opts.justification !== undefined && { justification: opts.justification }),
      before: { status: before.status },
      after: { status: 'cancelled', ...preview },
    });
  }
  const user = await subscriberOf(tx, subscription.userId);
  opts.fx.emailIds.push(
    await revenueMailer['subscription.cancelled'](
      tx,
      { to: user.email, dedupeKey: `subscription.cancelled:${subscriptionId}` },
      {
        name: user.name,
        categoryName: await categoryName(tx, subscription),
        link: new URL('/app/compras', opts.appBaseUrl).toString(),
        ...(preview.minutesLost !== undefined && { minutesLost: preview.minutesLost }),
      },
    ),
  );
  return subscription;
}

/** Runs one change per subscription in its own transaction, then flushes its effects. */
async function eachInOwnTransaction(
  deps: Pick<PaymentDeps, 'db' | 'env' | 'fetch' | 'registry' | 'now'>,
  ctx: RequestContext,
  ids: string[],
  work: (tx: Tx, id: string, fx: AfterCommit) => Promise<boolean>,
): Promise<number> {
  let changed = 0;
  for (const id of ids) {
    const fx = newAfterCommit();
    if (await deps.db.transaction((tx) => work(tx, id, fx))) changed += 1;
    await flushAfterCommit(deps, fx, ctx);
  }
  return changed;
}

/**
 * REC-54: a subscription whose next period is still unpaid on its `starts_on` becomes `suspended`;
 * the period stays `awaiting_payment`, its held occurrences expire (occupancy released) and
 * `subscription.suspended` is queued. Guarded: a re-run changes nothing.
 */
export async function suspendDue(
  deps: Pick<PaymentDeps, 'db' | 'env' | 'fetch' | 'registry' | 'now'>,
  ctx: RequestContext,
  now: Date,
): Promise<number> {
  const today = todayOf(now);
  const settings = await loadSettings(deps.db);
  const due = await deps.db
    .select({ id: subscriptions.id, periodId: subscriptionPeriods.id })
    .from(subscriptionPeriods)
    .innerJoin(subscriptions, eq(subscriptions.id, subscriptionPeriods.subscriptionId))
    .where(
      and(
        eq(subscriptions.status, 'active'),
        eq(subscriptionPeriods.status, 'awaiting_payment'),
        lte(subscriptionPeriods.startsOn, today),
      ),
    )
    .orderBy(asc(subscriptions.id));
  const periodOf = new Map(due.map((d) => [d.id, d.periodId]));
  return eachInOwnTransaction(deps, ctx, [...periodOf.keys()], async (tx, id, fx) => {
    const current = await lockSubscription(tx, id);
    if (current.status !== 'active') return false;
    const subscription = await transitionSubscription(tx, id, ['active'], 'suspended', now, {
      suspendedAt: now,
    });
    const periodId = periodOf.get(id) ?? '';
    const held = await occurrencesOf(tx, id, ['held_for_renewal'], { periodId });
    await transitionOccurrences(tx, ctx, held, 'expired', 'renewal_unpaid', now);
    const [period] = await tx
      .select()
      .from(subscriptionPeriods)
      .where(eq(subscriptionPeriods.id, periodId));
    const user = await subscriberOf(tx, subscription.userId);
    fx.emailIds.push(
      await revenueMailer['subscription.suspended'](
        tx,
        { to: user.email, dedupeKey: `subscription.suspended:${periodId}` },
        {
          name: user.name,
          categoryName: await categoryName(tx, subscription),
          link: new URL(`/app/compras/assinaturas/${id}/pagar`, deps.env.APP_BASE_URL).toString(),
          graceEndsOn: graceEndsOn(
            (period?.startsOn ?? today) as LocalDate,
            settings['payment.renewal_grace_days'],
          ),
        },
      ),
    );
    return true;
  });
}

/**
 * REC-57: still unpaid when `today ≥ starts_on + payment.renewal_grace_days` → subscription
 * `ended`, period `failed`, pending charge `cancelled`, `subscription.ended` queued.
 */
export async function endAfterGrace(
  deps: Pick<PaymentDeps, 'db' | 'env' | 'fetch' | 'registry' | 'now'>,
  ctx: RequestContext,
  now: Date,
): Promise<number> {
  const settings = await loadSettings(deps.db);
  const lastStart = addDays(todayOf(now), -settings['payment.renewal_grace_days']);
  const due = await deps.db
    .select({ id: subscriptions.id, periodId: subscriptionPeriods.id })
    .from(subscriptionPeriods)
    .innerJoin(subscriptions, eq(subscriptions.id, subscriptionPeriods.subscriptionId))
    .where(
      and(
        eq(subscriptions.status, 'suspended'),
        eq(subscriptionPeriods.status, 'awaiting_payment'),
        lte(subscriptionPeriods.startsOn, lastStart),
      ),
    )
    .orderBy(asc(subscriptions.id));
  const periodOf = new Map(due.map((d) => [d.id, d.periodId]));
  return eachInOwnTransaction(deps, ctx, [...periodOf.keys()], async (tx, id, fx) => {
    const current = await lockSubscription(tx, id);
    if (current.status !== 'suspended') return false;
    const subscription = await transitionSubscription(tx, id, ['suspended'], 'ended', now, {
      endedAt: now,
    });
    const periodId = periodOf.get(id) ?? '';
    fx.cancelCharges.push(...(await cancelPendingCharges(tx, ctx, [periodId])));
    await transitionPeriod(tx, periodId, ['awaiting_payment'], 'failed', now);
    for (const period of await periodsIn(tx, id, ['upcoming'])) {
      await transitionPeriod(tx, period.id, ['upcoming'], 'cancelled', now);
    }
    const user = await subscriberOf(tx, subscription.userId);
    fx.emailIds.push(
      await revenueMailer['subscription.ended'](
        tx,
        { to: user.email, dedupeKey: `subscription.ended:${id}` },
        {
          name: user.name,
          categoryName: await categoryName(tx, subscription),
          link: new URL('/precos', deps.env.APP_BASE_URL).toString(),
        },
      ),
    );
    return true;
  });
}

/** REC-56: a suspended fixed schedule re-holds the free future occurrences of its period. */
async function reholdFixed(
  tx: Tx,
  ctx: RequestContext,
  subscription: SubscriptionRow,
  period: PeriodRow,
  now: Date,
): Promise<PeriodRow> {
  const roomId = subscription.roomId;
  if (roomId === null) return period;
  const settings = await loadSettings(tx);
  const [category] = await tx
    .select()
    .from(bookingCategories)
    .where(eq(bookingCategories.id, subscription.categoryId));
  if (category === undefined) throw new Error('subscription category missing');
  const startsOn = period.startsOn as LocalDate;
  const dates = Array.from({ length: subscription.periodDays }, (_, i) => addDays(startsOn, i));
  const contexts = await loadDayContexts(tx, { roomId, dates, now });
  const plan = planFixedPeriod(category, roomId, startsOn, contexts, {
    cleanupMinutes: settings['calendar.cleanup_minutes'],
    notBefore: new Date(now.getTime() + settings['calendar.min_advance_minutes'] * 60_000),
    hours: await loadBusinessHours(tx),
  });
  const conflicting = new Set(plan.conflicts.map((c) => c.date));
  const already = new Set(
    (await occurrencesOf(tx, subscription.id, ['held_for_renewal'], { periodId: period.id })).map(
      (b) => b.startsAt.getTime(),
    ),
  );
  let held = already.size;
  for (const occurrence of plan.occurrences) {
    if (conflicting.has(occurrence.date) || already.has(occurrence.startsAt.getTime())) continue;
    const booking = await insertOccurrence(
      tx,
      ctx,
      {
        userId: subscription.userId,
        roomId,
        subscriptionId: subscription.id,
        periodId: period.id,
        status: 'held_for_renewal',
        holdExpiresAt: null,
        source: subscription.source as 'web' | 'app' | 'admin' | 'mcp',
        settings,
      },
      occurrence,
    );
    if (booking !== null) held += 1;
  }
  const [priced] = await tx
    .update(subscriptionPeriods)
    .set({
      occurrenceCount: held,
      priceCents: fixedPeriodPriceCents(category.pricePerOccurrenceCents ?? 0, held),
      updatedAt: now,
    })
    .where(eq(subscriptionPeriods.id, period.id))
    .returning();
  return priced ?? period;
}

/** Credits already applied to a period (internal charges not refunded). */
async function creditPaid(tx: Tx, periodId: string): Promise<number> {
  const rows = await tx
    .select({ amount: charges.amountCents, refunded: charges.refundedCents })
    .from(charges)
    .where(
      and(
        eq(charges.subscriptionPeriodId, periodId),
        eq(charges.method, 'credit'),
        inArray(charges.status, ['approved', 'partially_refunded']),
      ),
    );
  return rows.reduce((sum, r) => sum + r.amount - r.refunded, 0);
}

/**
 * `POST /app/subscriptions/:id/pay` (REC-56, REC-151): pays the first period of an
 * `awaiting_payment` subscription (`subscription_initial`), the pending renewal of an active one or
 * the regularization of a suspended one (`subscription_renewal`; hour package at full price, fixed
 * schedule re-held and priced per occurrence). Other pending charges of the period are cancelled.
 */
export async function payPending(
  deps: PaymentDeps,
  ctx: RequestContext,
  args: { userId: string; subscriptionId: string; body: PayInput },
): Promise<{ subscriptionId: string; charge: ChargeRow | null }> {
  const now = deps.now();
  const method: PayMethod = args.body.paymentMethod;
  await assertGatewayReady(deps, method);
  const fx = newAfterCommit();
  const result = await deps.db.transaction(async (tx) => {
    await ownedSubscription(tx, args.userId, args.subscriptionId);
    let subscription = await lockSubscription(tx, args.subscriptionId);
    let purpose: ChargePurpose;
    let period: PeriodRow | undefined;
    if (subscription.status === 'awaiting_payment') {
      if (subscription.holdExpiresAt !== null && subscription.holdExpiresAt <= now) {
        throw conflict('HOLD_EXPIRED', 'O prazo para pagar esta assinatura terminou.');
      }
      purpose = 'subscription_initial';
      [period] = await periodsIn(tx, subscription.id, ['awaiting_payment']);
    } else if (['active', 'suspended'].includes(subscription.status)) {
      purpose = 'subscription_renewal';
      [period] = await periodsIn(tx, subscription.id, ['awaiting_payment']);
      if (period !== undefined && subscription.status === 'suspended') {
        if (subscription.type === 'fixed_schedule') {
          period = await reholdFixed(tx, ctx, subscription, period, now);
        }
      }
    } else {
      throw new AppError(409, 'INVALID_TRANSITION', 'Esta assinatura não permite esta ação');
    }
    if (period === undefined) {
      throw conflict('INVALID_STATE', 'Não há valor a pagar agora.');
    }
    const savedCardId =
      method === 'saved_card'
        ? await assertRecurringCard(tx, args.userId, args.body.savedCardId)
        : null;
    fx.cancelCharges.push(...(await cancelPendingCharges(tx, ctx, [period.id])));
    const payable = period.priceCents - period.discountCents - (await creditPaid(tx, period.id));
    const credit =
      args.body.useCredits === true
        ? await applyCredits(tx, ctx, {
            userId: args.userId,
            amountCents: payable,
            purpose,
            periodId: period.id,
            now,
          })
        : { usedCents: 0, chargeId: null };
    const payNow = payable - credit.usedCents;
    const name = await categoryName(tx, subscription);
    if (payNow <= 0) {
      if (purpose === 'subscription_initial') {
        await activateSubscription(tx, ctx, subscription.id, {
          now,
          appBaseUrl: deps.env.APP_BASE_URL,
          fx,
        });
      } else {
        subscription = await lockSubscription(tx, subscription.id);
        await settleRenewal(tx, ctx, { period, subscription, now, amountCents: 0, fx });
      }
      return { charge: null, name };
    }
    const settings = await loadSettings(tx);
    const expiresAt =
      purpose === 'subscription_initial' && subscription.holdExpiresAt !== null
        ? subscription.holdExpiresAt
        : new Date(now.getTime() + settings['payment.checkout_hold_minutes'] * 60_000);
    const charge = await createCharge(tx, ctx, {
      purpose,
      userId: args.userId,
      amountCents: payNow,
      method,
      ...(savedCardId !== null && { savedCardId }),
      expiresAt,
      subscriptionPeriodId: period.id,
    });
    return { charge, name };
  });
  await flushAfterCommit(deps, fx, ctx);
  if (result.charge === null) return { subscriptionId: args.subscriptionId, charge: null };
  const submitted = await submitCharge(deps, result.charge.id, {
    description: `Assinatura ${result.name}`,
    returnUrl: '/app/compras',
  });
  return { subscriptionId: args.subscriptionId, charge: submitted };
}
