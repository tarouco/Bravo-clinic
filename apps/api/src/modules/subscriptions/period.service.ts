import {
  addDays,
  chargeDueAt,
  fixedPeriodPriceCents,
  occurrenceConflictLabel,
  periodBounds,
  utcToLocal,
  type LocalDate,
  type OccurrenceConflictReason,
} from '@bravo/core';
import { and, desc, eq } from 'drizzle-orm';
import type { Tx } from '../../db/client';
import { bookingCategories, subscriptionPeriods } from '../../db/schema';
import type { ChargeEffects } from '../../extensions/registry';
import type { RequestContext } from '../../lib/audit';
import { loadBusinessHours, loadDayContexts } from '../calendar/calendar.repo';
import { expirePeriod, grantPeriod } from '../packages/minutes.service';
import { loadSettings } from '../settings/settings.repo';
import { compensateKnownClosedDays } from './compensation.service';
import { insertOccurrence, occurrencesOf, subscriberOf } from './occurrences.service';
import { planFixedPeriod } from './quote.service';
import { revenueMailer } from './revenue-mailer';
import {
  lockSubscription,
  transitionPeriod,
  type PeriodRow,
  type SubscriptionRow,
} from './transitions';

// Period lifecycle (REC-16, REC-53, REC-61, REC-92, REC-93, REC-102): activation grants the
// included minutes once, compensates closed days already known and, for a fixed schedule, holds
// the next period's occurrences; closing expires what is left; the renewal period is priced from
// the category values in force.

type CategoryRow = typeof bookingCategories.$inferSelect;

export interface PeriodOptions {
  now: Date;
  appBaseUrl: string;
  fx: ChargeEffects;
}

/** The clinic's local date of `now`. */
export const todayOf = (now: Date): LocalDate => utcToLocal(now).date;

async function categoryOf(tx: Tx, subscription: SubscriptionRow): Promise<CategoryRow> {
  const [category] = await tx
    .select()
    .from(bookingCategories)
    .where(eq(bookingCategories.id, subscription.categoryId));
  if (category === undefined) throw new Error('subscription category missing');
  return category;
}

/**
 * `paid | awaiting_payment → active` with `paid_at` (REC-16, REC-17, REC-53). An hour-package
 * period gets its `period_grant` and the compensation of the clinic closures already inside it
 * (REC-102); a fixed-schedule period holds the next period (REC-92). The guarded transition makes
 * a second activation fail instead of granting twice.
 */
export async function activatePeriod(
  tx: Tx,
  ctx: RequestContext,
  periodId: string,
  opts: PeriodOptions,
): Promise<PeriodRow> {
  const { now } = opts;
  const [current] = await tx
    .select({ paidAt: subscriptionPeriods.paidAt })
    .from(subscriptionPeriods)
    .where(eq(subscriptionPeriods.id, periodId))
    .for('update');
  let period = await transitionPeriod(tx, periodId, ['paid', 'awaiting_payment'], 'active', now, {
    paidAt: current?.paidAt ?? now,
  });
  if (period.includedMinutes !== null && period.includedMinutes > 0) {
    period = await grantPeriod(tx, ctx, {
      periodId: period.id,
      minutes: period.includedMinutes,
      now,
    });
    await compensateKnownClosedDays(tx, period.id, ctx, { now, appBaseUrl: opts.appBaseUrl });
  }
  const subscription = await lockSubscription(tx, period.subscriptionId);
  if (subscription.type === 'fixed_schedule') {
    await holdNextFixedPeriod(tx, ctx, subscription, period, opts);
  }
  return period;
}

/**
 * REC-92, REC-93: the next period `upcoming` with each free occurrence held as `held_for_renewal`;
 * dates that cannot be held go to `held_conflicts` and one `subscription.next_period_conflicts`
 * e-mail. Its price is per occurrence (current category) × held count. Re-running holds nothing
 * twice (unique `(subscription_id, seq)`).
 */
export async function holdNextFixedPeriod(
  tx: Tx,
  ctx: RequestContext,
  subscription: SubscriptionRow,
  period: PeriodRow,
  opts: PeriodOptions,
): Promise<PeriodRow | null> {
  const { now } = opts;
  const roomId = subscription.roomId;
  if (roomId === null) return null;
  const settings = await loadSettings(tx);
  const category = await categoryOf(tx, subscription);
  const startsOn = period.endsOn as LocalDate;
  const { endsOn } = periodBounds(startsOn, subscription.periodDays);
  const [next] = await tx
    .insert(subscriptionPeriods)
    .values({
      subscriptionId: subscription.id,
      seq: period.seq + 1,
      startsOn,
      endsOn,
      priceCents: 0,
      occurrenceCount: 0,
      priceSnapshot: period.priceSnapshot,
      status: 'upcoming',
      chargeDueAt: chargeDueAt(startsOn, settings['payment.subscription_renewal_days_before']),
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning();
  if (next === undefined) return null;

  const dates = Array.from({ length: subscription.periodDays }, (_, i) => addDays(startsOn, i));
  const contexts = await loadDayContexts(tx, { roomId, dates, now });
  const plan = planFixedPeriod(category, roomId, startsOn, contexts, {
    cleanupMinutes: settings['calendar.cleanup_minutes'],
    notBefore: new Date(now.getTime() + settings['calendar.min_advance_minutes'] * 60_000),
    hours: await loadBusinessHours(tx),
  });
  const conflicts: { date: LocalDate; reason: OccurrenceConflictReason }[] = plan.conflicts.map(
    (c) => ({ date: c.date, reason: c.reason }),
  );
  const conflictDates = new Set(conflicts.map((c) => c.date));
  let held = 0;
  for (const occurrence of plan.occurrences) {
    if (conflictDates.has(occurrence.date)) continue;
    const booking = await insertOccurrence(
      tx,
      ctx,
      {
        userId: subscription.userId,
        roomId,
        subscriptionId: subscription.id,
        periodId: next.id,
        status: 'held_for_renewal',
        holdExpiresAt: null,
        source: subscription.source as 'web' | 'app' | 'admin' | 'mcp',
        settings,
      },
      occurrence,
    );
    if (booking === null) conflicts.push({ date: occurrence.date, reason: 'overlaps_booking' });
    else held += 1;
  }
  conflicts.sort((a, b) => (a.date < b.date ? -1 : 1));
  const [priced] = await tx
    .update(subscriptionPeriods)
    .set({
      occurrenceCount: held,
      priceCents: fixedPeriodPriceCents(category.pricePerOccurrenceCents ?? 0, held),
      heldConflicts: conflicts,
      updatedAt: now,
    })
    .where(eq(subscriptionPeriods.id, next.id))
    .returning();
  if (conflicts.length > 0) {
    const user = await subscriberOf(tx, subscription.userId);
    opts.fx.emailIds.push(
      await revenueMailer['subscription.next_period_conflicts'](
        tx,
        { to: user.email, dedupeKey: `next_period_conflicts:${next.id}` },
        {
          name: user.name,
          categoryName: category.name,
          link: new URL('/app/compras', opts.appBaseUrl).toString(),
          conflicts: conflicts.map((c) => ({
            date: c.date,
            label: occurrenceConflictLabel(c.reason),
          })),
        },
      ),
    );
  }
  return priced ?? next;
}

/** `active → closed` with an `expiry` entry for the package minutes left (REC-53). */
export async function closePeriod(
  tx: Tx,
  ctx: RequestContext,
  periodId: string,
  now: Date,
): Promise<{ period: PeriodRow; expiredMinutes: number }> {
  let expiredMinutes = 0;
  const [current] = await tx
    .select()
    .from(subscriptionPeriods)
    .where(eq(subscriptionPeriods.id, periodId))
    .for('update');
  if (current?.status === 'active' && current.minutesBalance !== null) {
    expiredMinutes = (await expirePeriod(tx, ctx, { periodId, now })).expiredMinutes;
  }
  const period = await transitionPeriod(tx, periodId, ['active'], 'closed', now);
  return { period, expiredMinutes };
}

/** The held occurrences of a fixed period still waiting for its renewal (closed days removed). */
export async function heldCount(tx: Tx, subscriptionId: string, periodId: string): Promise<number> {
  return (await occurrencesOf(tx, subscriptionId, ['held_for_renewal'], { periodId })).length;
}

/**
 * The renewal period (REC-47, REC-93, REC-125), priced from the current category without coupon:
 * an hour package gets a new `awaiting_payment` row after the latest period; a fixed schedule
 * promotes its `upcoming` period, priced per occurrence × the occurrences still held. An existing
 * awaiting period is returned as it is.
 */
export async function createRenewalPeriod(
  tx: Tx,
  subscriptionId: string,
  now: Date,
): Promise<PeriodRow | null> {
  const subscription = await lockSubscription(tx, subscriptionId);
  const category = await categoryOf(tx, subscription);
  const [latest] = await tx
    .select()
    .from(subscriptionPeriods)
    .where(eq(subscriptionPeriods.subscriptionId, subscriptionId))
    .orderBy(desc(subscriptionPeriods.seq))
    .limit(1)
    .for('update');
  if (latest === undefined) return null;
  if (latest.status === 'awaiting_payment') return latest;

  if (subscription.type === 'fixed_schedule') {
    if (latest.status !== 'upcoming') return null;
    const count = await heldCount(tx, subscriptionId, latest.id);
    return transitionPeriod(tx, latest.id, ['upcoming'], 'awaiting_payment', now, {
      occurrenceCount: count,
      priceCents: fixedPeriodPriceCents(category.pricePerOccurrenceCents ?? 0, count),
      discountCents: 0,
      priceSnapshot: {
        categoryVersion: category.version,
        pricePerOccurrenceCents: category.pricePerOccurrenceCents,
        weekdays: category.weekdays,
        startMinute: category.startMinute,
        endMinute: category.endMinute,
      },
    });
  }

  if (latest.status !== 'active') return null;
  const settings = await loadSettings(tx);
  const startsOn = latest.endsOn as LocalDate;
  const { endsOn } = periodBounds(startsOn, subscription.periodDays);
  const [created] = await tx
    .insert(subscriptionPeriods)
    .values({
      subscriptionId,
      seq: latest.seq + 1,
      startsOn,
      endsOn,
      priceCents: category.fixedPriceCents ?? 0,
      discountCents: 0,
      includedMinutes: category.includedMinutes,
      minutesBalance: 0,
      priceSnapshot: {
        categoryVersion: category.version,
        priceCents: category.fixedPriceCents,
        includedMinutes: category.includedMinutes,
      },
      status: 'awaiting_payment',
      chargeDueAt: chargeDueAt(startsOn, settings['payment.subscription_renewal_days_before']),
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning();
  if (created !== undefined) return created;
  const [existing] = await tx
    .select()
    .from(subscriptionPeriods)
    .where(
      and(
        eq(subscriptionPeriods.subscriptionId, subscriptionId),
        eq(subscriptionPeriods.seq, latest.seq + 1),
      ),
    );
  return existing ?? null;
}
