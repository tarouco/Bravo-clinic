import {
  addDays,
  chargeDueAt,
  convertPackageBalance,
  fixedPeriodPriceCents,
  periodBounds,
  periodDaysOf,
  type LocalDate,
  type SettingsValues,
  type SwitchInput,
  type SwitchQuote,
  type SwitchQuoteInput,
} from '@bravo/core';
import { and, eq, inArray } from 'drizzle-orm';
import type { Db, Tx } from '../../db/client';
import { bookingCategories, charges, subscriptionPeriods } from '../../db/schema';
import type { BookingRow, ChargeEffects, ChargeRow } from '../../extensions/registry';
import { getEnv } from '../../env';
import type { RequestContext } from '../../lib/audit';
import { AppError, validationFailed } from '../../lib/errors';
import { flushAfterCommit, newAfterCommit } from '../booking/effects';
import { loadBusinessHours, loadDayContexts, type DayContext } from '../calendar/calendar.repo';
import { applyCredits } from '../credits/credits.service';
import { addPeriodEntry } from '../packages/minutes.service';
import {
  cancelCharge,
  createCharge,
  submitCharge,
  type PayMethod,
  type PaymentDeps,
} from '../payments/charges.service';
import { addHoursToInstant } from '../revenue/instants';
import { loadSettings } from '../settings/settings.repo';
import { refundLate, returnCredits } from './late-refund';
import {
  insertOccurrence,
  occurrenceConflict,
  occurrencesOf,
  subscriberOf,
  transitionOccurrences,
} from './occurrences.service';
import { activatePeriod, closePeriod, todayOf } from './period.service';
import { assertGatewayReady, assertRecurringCard, insertSubscription } from './purchase.service';
import { loadPackageCategory, planFixedPeriod } from './quote.service';
import { revenueMailer } from './revenue-mailer';
import {
  lockSubscription,
  ownedSubscription,
  transitionPeriod,
  transitionSubscription,
  type SubscriptionRow,
} from './transitions';

// Package switch (REC-72..REC-78): within hour packages (balance converted at approval) or within
// fixed schedules (old occurrences released, new ones reserved). The new subscription waits for
// payment with `switch_from_subscription_id`; the approval completes the switch in its transaction.

type CategoryRow = typeof bookingCategories.$inferSelect;
type PackagePeriod = 'monthly' | 'bimonthly' | 'quarterly';
const LIVE_OCCURRENCES = ['awaiting_payment', 'pre_reserved', 'confirmed'] as const;

const rateOf = (snapshot: unknown) => {
  const s = snapshot as { priceCents?: number; includedMinutes?: number } | null;
  return { priceCents: s?.priceCents ?? 0, includedMinutes: s?.includedMinutes ?? 0 };
};

/** REC-76: same type, another category. */
async function targetCategory(
  db: Db | Tx,
  current: SubscriptionRow,
  categoryId: string,
): Promise<CategoryRow> {
  const reject = () =>
    validationFailed([
      { path: ['categoryId'], message: 'Escolha outro pacote do mesmo tipo para trocar' },
    ]);
  if (categoryId === current.categoryId) throw reject();
  const target = await loadPackageCategory(db, categoryId).catch(() => {
    throw reject();
  });
  if (target.type !== current.type) throw reject();
  return target;
}

async function activePeriodOf(db: Db | Tx, subscriptionId: string) {
  const [period] = await db
    .select()
    .from(subscriptionPeriods)
    .where(
      and(
        eq(subscriptionPeriods.subscriptionId, subscriptionId),
        eq(subscriptionPeriods.status, 'active'),
      ),
    );
  return period ?? null;
}

/** Day contexts of the new period without the old subscription's own occurrences (REC-77). */
async function contextsWithout(
  db: Db | Tx,
  roomId: string,
  startsOn: LocalDate,
  days: number,
  own: BookingRow[],
  now: Date,
): Promise<Map<LocalDate, DayContext>> {
  const dates = Array.from({ length: days }, (_, i) => addDays(startsOn, i));
  const contexts = await loadDayContexts(db, { roomId, dates, now });
  const mine = new Set(
    own
      .filter((b) => b.roomId === roomId)
      .map((b) => `${String(b.startsAt.getTime())}-${String(b.endsAt.getTime())}`),
  );
  for (const context of contexts.values()) {
    context.occupied = context.occupied.filter(
      (o) =>
        !(
          o.kind === 'booking' &&
          mine.has(`${String(o.start.getTime())}-${String(o.end.getTime())}`)
        ),
    );
  }
  return contexts;
}

async function fixedPlan(
  db: Db | Tx,
  current: SubscriptionRow,
  target: CategoryRow,
  roomId: string,
  startsOn: LocalDate,
  settings: SettingsValues,
  now: Date,
) {
  const own = await occurrencesOf(db as Tx, current.id, [...LIVE_OCCURRENCES, 'held_for_renewal']);
  const days = periodDaysOf(target.period as PackagePeriod);
  const contexts = await contextsWithout(db, roomId, startsOn, days, own, now);
  const plan = planFixedPeriod(target, roomId, startsOn, contexts, {
    cleanupMinutes: settings['calendar.cleanup_minutes'],
    notBefore: new Date(now.getTime() + settings['calendar.min_advance_minutes'] * 60_000),
    hours: await loadBusinessHours(db),
  });
  const released = own.filter(
    (b) => b.status === 'held_for_renewal' || b.startsAt.getTime() > now.getTime(),
  ).length;
  return { plan, released };
}

/** `POST /app/subscriptions/:id/switch/quote` (REC-72, REC-76). */
export async function quoteSwitch(
  db: Db | Tx,
  args: { userId: string; subscriptionId: string; input: SwitchQuoteInput; now: Date },
): Promise<SwitchQuote> {
  const { now } = args;
  const current = await ownedSubscription(db, args.userId, args.subscriptionId);
  if (current.status !== 'active') {
    await transitionGuard(current);
  }
  const target = await targetCategory(db, current, args.input.categoryId);
  const settings = await loadSettings(db);
  const today = todayOf(now);
  const days = periodDaysOf(target.period as PackagePeriod);
  const { startsOn, endsOn } = periodBounds(today, days);
  if (target.type === 'hour_package') {
    const period = await activePeriodOf(db, current.id);
    const remainingMinutes = period?.minutesBalance ?? 0;
    const to = {
      priceCents: target.fixedPriceCents ?? 0,
      includedMinutes: target.includedMinutes ?? 0,
    };
    const convertedMinutes = convertPackageBalance({
      remainingMinutes,
      from: rateOf(period?.priceSnapshot ?? current.priceSnapshot),
      to,
    });
    return {
      remainingMinutes,
      convertedMinutes,
      newIncludedMinutes: to.includedMinutes,
      newPeriodTotalMinutes: to.includedMinutes + convertedMinutes,
      startsOn,
      endsOn,
      priceCents: to.priceCents,
      creditAppliedCents: 0,
      payNowCents: to.priceCents,
    };
  }
  const roomId = args.input.roomId ?? current.roomId ?? '';
  const { plan, released } = await fixedPlan(db, current, target, roomId, startsOn, settings, now);
  return {
    releasedOccurrences: released,
    startsOn,
    endsOn,
    priceCents: plan.periodPriceCents,
    creditAppliedCents: 0,
    payNowCents: plan.periodPriceCents,
    conflicts: plan.conflicts,
  };
}

function transitionGuard(current: SubscriptionRow): Promise<never> {
  return Promise.reject(
    new AppError(409, 'INVALID_TRANSITION', 'Esta assinatura não permite esta ação', {
      from: current.status,
      to: 'switched',
    }),
  );
}

/**
 * `POST /app/subscriptions/:id/switch` (REC-72..REC-77): the new subscription `awaiting_payment`
 * (`switch_from_subscription_id` = the current one), period from today, full price without coupon,
 * credits allowed. Fixed occurrences that do not overlap the old ones are held now, the others at
 * approval. Nothing to pay completes the switch at once.
 */
export async function startSwitch(
  deps: PaymentDeps,
  ctx: RequestContext,
  args: { userId: string; subscriptionId: string; body: SwitchInput },
): Promise<{ subscriptionId: string; charge: ChargeRow | null }> {
  const now = deps.now();
  const { body } = args;
  const method: PayMethod = body.paymentMethod;
  await assertGatewayReady(deps, method);
  const fx = newAfterCommit();
  const result = await deps.db.transaction(async (tx) => {
    const owned = await ownedSubscription(tx, args.userId, args.subscriptionId);
    const current = await lockSubscription(tx, owned.id);
    if (current.status !== 'active') await transitionGuard(current);
    const target = await targetCategory(tx, current, body.categoryId);
    const settings = await loadSettings(tx);
    const savedCardId =
      method === 'saved_card' ? await assertRecurringCard(tx, args.userId, body.savedCardId) : null;
    const today = todayOf(now);
    const roomId = target.type === 'fixed_schedule' ? (body.roomId ?? current.roomId) : null;
    let priceCents = target.fixedPriceCents ?? 0;
    let plan: Awaited<ReturnType<typeof fixedPlan>>['plan'] | null = null;
    if (roomId !== null) {
      plan = (await fixedPlan(tx, current, target, roomId, today, settings, now)).plan;
      if (plan.conflicts.length > 0) throw occurrenceConflict(plan.conflicts);
      priceCents = plan.periodPriceCents;
    }
    const hold = addHoursToInstant(now, settings['payment.checkout_hold_minutes'] / 60);
    const { subscription, period } = await insertSubscription(tx, ctx, {
      userId: args.userId,
      category: target,
      baseOn: today,
      roomId,
      priceCents,
      discountCents: 0,
      occurrenceCount: plan?.occurrences.length ?? null,
      holdExpiresAt: hold,
      paymentMethod: savedCardId === null ? 'pix' : 'saved_card',
      savedCardId,
      firstCouponId: null,
      saleMode: 'self',
      source: current.source as 'web' | 'app' | 'admin' | 'mcp',
      settings,
      now,
      switchFromSubscriptionId: current.id,
    });
    if (plan !== null && roomId !== null) {
      for (const occurrence of plan.occurrences) {
        // A slot of the old subscription's own occurrences is reserved at approval (REC-77).
        await insertOccurrence(
          tx,
          ctx,
          {
            userId: args.userId,
            roomId,
            subscriptionId: subscription.id,
            periodId: period.id,
            status: 'awaiting_payment',
            holdExpiresAt: hold,
            source: subscription.source as 'web' | 'app' | 'admin' | 'mcp',
            settings,
          },
          occurrence,
        );
      }
    }
    const credit =
      body.useCredits === true
        ? await applyCredits(tx, ctx, {
            userId: args.userId,
            amountCents: priceCents,
            purpose: 'subscription_initial',
            periodId: period.id,
            now,
          })
        : { usedCents: 0, chargeId: null };
    const payNow = priceCents - credit.usedCents;
    if (payNow === 0) {
      await completeSwitch(tx, ctx, subscription, null, { now, fx });
      return { subscriptionId: subscription.id, charge: null, name: target.name };
    }
    const charge = await createCharge(tx, ctx, {
      purpose: 'subscription_initial',
      userId: args.userId,
      amountCents: payNow,
      method,
      ...(savedCardId !== null && { savedCardId }),
      expiresAt: hold,
      subscriptionPeriodId: period.id,
    });
    return { subscriptionId: subscription.id, charge, name: target.name };
  });
  await flushAfterCommit(deps, fx, ctx);
  if (result.charge === null) return { subscriptionId: result.subscriptionId, charge: null };
  const submitted = await submitCharge(deps, result.charge.id, {
    description: `Troca para ${result.name}`,
    returnUrl: '/app/compras',
  });
  return { subscriptionId: result.subscriptionId, charge: submitted };
}

class SwitchSlotTaken extends Error {}

/** Cancels the old subscription's periods still to come and their pending charges. */
async function cancelFuturePeriods(tx: Tx, ctx: RequestContext, subscriptionId: string, now: Date) {
  const future = await tx
    .select()
    .from(subscriptionPeriods)
    .where(
      and(
        eq(subscriptionPeriods.subscriptionId, subscriptionId),
        inArray(subscriptionPeriods.status, ['upcoming', 'awaiting_payment']),
      ),
    );
  for (const period of future) {
    const pending = await tx
      .select({ id: charges.id })
      .from(charges)
      .where(and(eq(charges.subscriptionPeriodId, period.id), eq(charges.status, 'pending')));
    for (const charge of pending) await cancelCharge(tx, ctx, charge.id);
    await transitionPeriod(tx, period.id, ['upcoming', 'awaiting_payment'], 'cancelled', now);
  }
}

/** The new subscription could not be served: expired, holds released, credits returned. */
async function abandonSwitch(tx: Tx, ctx: RequestContext, next: SubscriptionRow, now: Date) {
  await transitionSubscription(tx, next.id, ['awaiting_payment'], 'expired', now, {
    holdExpiresAt: null,
  });
  const periods = await tx
    .select()
    .from(subscriptionPeriods)
    .where(eq(subscriptionPeriods.subscriptionId, next.id));
  for (const period of periods) {
    await returnCredits(tx, ctx, { periodId: period.id }, now);
    if (period.status === 'awaiting_payment') {
      await transitionPeriod(tx, period.id, ['awaiting_payment'], 'cancelled', now);
    }
  }
  const held = await occurrencesOf(tx, next.id, ['awaiting_payment']);
  await transitionOccurrences(tx, ctx, held, 'expired', 'switch_conflict', now);
}

/**
 * Completes a switch at approval (REC-73, REC-74, REC-77, REC-78), in the approval transaction:
 * hour packages convert the balance left now; fixed schedules release the old future occurrences
 * and reserve the new ones (a slot taken at this point refunds the charge and keeps the old
 * subscription). The new base date is the approval's local date.
 */
export async function completeSwitch(
  tx: Tx,
  ctx: RequestContext,
  next: SubscriptionRow,
  charge: ChargeRow | null,
  opts: { now: Date; fx: ChargeEffects },
): Promise<boolean> {
  const { now, fx } = opts;
  const appBaseUrl = getEnv().APP_BASE_URL;
  const oldId = next.switchFromSubscriptionId;
  if (oldId === null) return false;
  const old = await lockSubscription(tx, oldId);
  if (old.status !== 'active') {
    if (charge !== null) await refundLate(tx, ctx, charge, next, fx, `switch_from_${old.status}`);
    await abandonSwitch(tx, ctx, next, now);
    return false;
  }
  const today = todayOf(now);
  const settings = await loadSettings(tx);
  const [target] = await tx
    .select()
    .from(bookingCategories)
    .where(eq(bookingCategories.id, next.categoryId));
  if (target === undefined) throw new Error('switch target category missing');
  const { endsOn } = periodBounds(today, next.periodDays);
  const [first] = await tx
    .select()
    .from(subscriptionPeriods)
    .where(
      and(
        eq(subscriptionPeriods.subscriptionId, next.id),
        eq(subscriptionPeriods.status, 'awaiting_payment'),
      ),
    );
  if (first === undefined) throw new Error('switch target without an awaiting period');
  const oldPeriod = await activePeriodOf(tx, old.id);

  if (next.type === 'fixed_schedule' && next.roomId !== null) {
    const roomId = next.roomId;
    try {
      await tx.transaction(async (sp) => {
        const own = await occurrencesOf(sp, old.id, [...LIVE_OCCURRENCES, 'held_for_renewal']);
        const future = own.filter((b) => b.status !== 'held_for_renewal' && b.startsAt > now);
        await transitionOccurrences(sp, ctx, future, 'cancelled_by_tenant', 'switched', now);
        await transitionOccurrences(
          sp,
          ctx,
          own.filter((b) => b.status === 'held_for_renewal'),
          'expired',
          'switched',
          now,
        );
        const contexts = await contextsWithout(sp, roomId, today, next.periodDays, [], now);
        const plan = planFixedPeriod(target, roomId, today, contexts, {
          cleanupMinutes: settings['calendar.cleanup_minutes'],
          notBefore: new Date(now.getTime() + settings['calendar.min_advance_minutes'] * 60_000),
          hours: await loadBusinessHours(sp),
        });
        const held = await occurrencesOf(sp, next.id, ['awaiting_payment']);
        const wanted = new Set(plan.occurrences.map((o) => o.startsAt.getTime()));
        await transitionOccurrences(
          sp,
          ctx,
          held.filter((b) => !wanted.has(b.startsAt.getTime())),
          'expired',
          'switch_rebased',
          now,
        );
        const have = new Set(held.map((b) => b.startsAt.getTime()));
        for (const occurrence of plan.occurrences) {
          if (have.has(occurrence.startsAt.getTime())) continue;
          const booking = await insertOccurrence(
            sp,
            ctx,
            {
              userId: next.userId,
              roomId,
              subscriptionId: next.id,
              periodId: first.id,
              status: 'awaiting_payment',
              holdExpiresAt: null,
              source: next.source as 'web' | 'app' | 'admin' | 'mcp',
              settings,
            },
            occurrence,
          );
          if (booking === null) throw new SwitchSlotTaken(occurrence.date);
        }
        const count = plan.occurrences.length;
        await sp
          .update(subscriptionPeriods)
          .set({
            occurrenceCount: count,
            priceCents: fixedPeriodPriceCents(target.pricePerOccurrenceCents ?? 0, count),
          })
          .where(eq(subscriptionPeriods.id, first.id));
      });
    } catch (error) {
      if (!(error instanceof SwitchSlotTaken)) throw error;
      if (charge !== null) await refundLate(tx, ctx, charge, next, fx, 'switch_slot_taken');
      await abandonSwitch(tx, ctx, next, now);
      return false;
    }
  }

  let remaining = 0;
  if (oldPeriod !== null) {
    remaining = oldPeriod.minutesBalance ?? 0;
    if (remaining > 0) {
      await addPeriodEntry(tx, ctx, {
        periodId: oldPeriod.id,
        entryType: 'conversion_out',
        minutes: -remaining,
        now,
        detail: { toSubscriptionId: next.id },
      });
    }
    await closePeriod(tx, ctx, oldPeriod.id, now);
  }
  await cancelFuturePeriods(tx, ctx, old.id, now);
  await transitionSubscription(tx, old.id, ['active'], 'switched', now, {
    switchedToSubscriptionId: next.id,
    endedAt: now,
  });

  await tx
    .update(subscriptionPeriods)
    .set({
      startsOn: today,
      endsOn,
      chargeDueAt: chargeDueAt(today, settings['payment.subscription_renewal_days_before']),
    })
    .where(eq(subscriptionPeriods.id, first.id));
  await transitionSubscription(tx, next.id, ['awaiting_payment'], 'active', now, {
    baseOn: today,
    holdExpiresAt: null,
  });
  const activated = await activatePeriod(tx, ctx, first.id, { now, appBaseUrl, fx });
  let converted = 0;
  if (next.type === 'hour_package' && remaining > 0 && oldPeriod !== null) {
    converted = convertPackageBalance({
      remainingMinutes: remaining,
      from: rateOf(oldPeriod.priceSnapshot),
      to: rateOf(activated.priceSnapshot),
    });
    if (converted > 0) {
      await addPeriodEntry(tx, ctx, {
        periodId: first.id,
        entryType: 'conversion_in',
        minutes: converted,
        now,
        detail: { fromSubscriptionId: old.id, fromMinutes: remaining },
      });
    }
  }
  const occurrences = await occurrencesOf(tx, next.id, ['awaiting_payment']);
  await transitionOccurrences(tx, ctx, occurrences, 'confirmed', 'subscription_paid', now);

  const [oldCategory] = await tx
    .select({ name: bookingCategories.name })
    .from(bookingCategories)
    .where(eq(bookingCategories.id, old.categoryId));
  const user = await subscriberOf(tx, next.userId);
  fx.emailIds.push(
    await revenueMailer['subscription.switched'](
      tx,
      { to: user.email, dedupeKey: `subscription.switched:${next.id}` },
      {
        name: user.name,
        categoryName: target.name,
        fromCategoryName: oldCategory?.name ?? '',
        link: new URL('/app/compras', appBaseUrl).toString(),
        startsOn: today,
        ...(next.type === 'hour_package' && { convertedMinutes: converted }),
      },
    ),
  );
  fx.staff.push({
    event: 'new_subscription',
    payload: { entityId: next.id, switchedFrom: old.id },
  });
  return true;
}
