import { chargeDueAt, localToUtc, periodEndNoticeDates, type LocalDate } from '@bravo/core';
import { and, asc, desc, eq, inArray, isNull, ne } from 'drizzle-orm';
import type { Tx } from '../db/client';
import { charges, subscriptionPeriods, subscriptions, users } from '../db/schema';
import type { ChargeRow } from '../extensions/registry';
import { uniqueViolationConstraint } from '../lib/errors';
import { logger } from '../lib/logger';
import { flushAfterCommit, newAfterCommit, type AfterCommit } from '../modules/booking/effects';
import { applyCredits } from '../modules/credits/credits.service';
import { listSavedCards } from '../modules/payments/cards.service';
import { createCharge, submitCharge } from '../modules/payments/charges.service';
import { activeProvider } from '../payments/resolver';
import { loadSettings } from '../modules/settings/settings.repo';
import { settleRenewal } from '../modules/subscriptions/charge-handlers';
import { categoryName } from '../modules/subscriptions/late-refund';
import { subscriberOf } from '../modules/subscriptions/occurrences.service';
import { createRenewalPeriod, todayOf } from '../modules/subscriptions/period.service';
import { revenueMailer } from '../modules/subscriptions/revenue-mailer';
import {
  lockSubscription,
  type PeriodRow,
  type SubscriptionRow,
} from '../modules/subscriptions/transitions';
import { JOB_CONTEXT, type Job, type JobDeps } from './runner';

// Daily renewals at 03:00 BRT (REC-47..REC-52, REC-58, REC-93, REC-115, REC-125, REC-161): due
// periods are created (hour package) or promoted (fixed schedule) and priced from the current
// category, credits are applied FIFO, the rest is charged on the saved card (attempt 1, one retry
// the next day before `starts_on`) or by Pix with a daily reminder; period-ending notices go out 7
// and 1 days before `ends_on`. Each subscription is handled in its own transaction; re-runs change
// nothing (unique period seq, charge key `renewal:<periodId>:<attempt>`, e-mail dedupe keys).

const BATCH = 50;
const MAX_ATTEMPTS = 2;

type Method = 'saved_card' | 'pix';

/** The subscription's card when it can still be charged on the active gateway (REC-52). */
async function usableCard(
  tx: Tx,
  subscription: SubscriptionRow,
): Promise<{ id: string; last4: string | null } | null> {
  if (subscription.paymentMethod !== 'saved_card' || subscription.savedCardId === null) return null;
  const card = (await listSavedCards(tx, subscription.userId)).find(
    (c) => c.id === subscription.savedCardId,
  );
  if (card === undefined || card.recurringConsentAt === null) return null;
  if (card.provider !== (await activeProvider(tx))) return null;
  return { id: card.id, last4: card.last4 };
}

interface Planned {
  chargeId: string;
  method: Method;
  askCardUpdate: boolean;
  cardLast4: string | null;
  attempt: number;
}

/** Credits, then one charge of `attempt` for what is left; nothing left settles the period. */
async function chargeRenewal(
  tx: Tx,
  subscription: SubscriptionRow,
  period: PeriodRow,
  attempt: number,
  now: Date,
  fx: AfterCommit,
): Promise<Planned | null> {
  let payable = period.priceCents - period.discountCents;
  if (attempt === 1) {
    const credit = await applyCredits(tx, JOB_CONTEXT, {
      userId: subscription.userId,
      amountCents: payable,
      purpose: 'subscription_renewal',
      periodId: period.id,
      now,
    });
    payable -= credit.usedCents;
  } else {
    const [paid] = await tx
      .select({ amount: charges.amountCents })
      .from(charges)
      .where(
        and(
          eq(charges.subscriptionPeriodId, period.id),
          eq(charges.method, 'credit'),
          eq(charges.status, 'approved'),
        ),
      );
    payable -= paid?.amount ?? 0;
  }
  await tx
    .update(subscriptionPeriods)
    .set({ renewalAttempts: attempt, updatedAt: now })
    .where(eq(subscriptionPeriods.id, period.id));
  if (payable <= 0) {
    const locked = await lockSubscription(tx, subscription.id);
    await settleRenewal(tx, JOB_CONTEXT, { period, subscription: locked, now, amountCents: 0, fx });
    return null;
  }
  const card = await usableCard(tx, subscription);
  const method: Method = card === null ? 'pix' : 'saved_card';
  const charge = await createCharge(tx, JOB_CONTEXT, {
    purpose: 'subscription_renewal',
    userId: subscription.userId,
    amountCents: payable,
    method,
    ...(card !== null && { savedCardId: card.id }),
    expiresAt: localToUtc(period.startsOn as LocalDate, 0),
    subscriptionPeriodId: period.id,
    idempotencyKey: `renewal:${period.id}:${String(attempt)}`,
  });
  // The job's clock dates the attempt (retry "on the next daily run", one reminder per day).
  await tx.update(charges).set({ createdAt: now, updatedAt: now }).where(eq(charges.id, charge.id));
  return {
    chargeId: charge.id,
    method,
    askCardUpdate: card === null && subscription.paymentMethod === 'saved_card',
    cardLast4: card?.last4 ?? null,
    attempt,
  };
}

/** After commit: the gateway call, then the `subscription.renewal_charge` e-mail (REC-161). */
async function submitAndNotify(
  deps: JobDeps,
  subscription: SubscriptionRow,
  period: PeriodRow,
  planned: Planned,
): Promise<void> {
  let charge: ChargeRow | null = null;
  try {
    charge = await submitCharge(deps, planned.chargeId, {
      returnUrl: `/app/compras/assinaturas/${subscription.id}/pagar`,
    });
  } catch (error) {
    // The charge stays pending; reconciliation or the next run resolves it.
    logger.error('renewal charge submission failed', {
      chargeId: planned.chargeId,
      error: { name: (error as Error).name, message: (error as Error).message },
    });
  }
  const fx = newAfterCommit();
  await deps.db.transaction(async (tx) => {
    const user = await subscriberOf(tx, subscription.userId);
    fx.emailIds.push(
      await revenueMailer['subscription.renewal_charge'](
        tx,
        { to: user.email, dedupeKey: `renewal_charge:${period.id}:${String(planned.attempt)}` },
        {
          name: user.name,
          categoryName: await categoryName(tx, subscription),
          link: new URL(
            `/app/compras/assinaturas/${subscription.id}/pagar`,
            deps.env.APP_BASE_URL,
          ).toString(),
          amountCents: charge?.amountCents ?? period.priceCents,
          dueOn: period.startsOn as LocalDate,
          method: planned.method,
          ...(planned.cardLast4 !== null && { cardLast4: planned.cardLast4 }),
          pixCopyPaste: charge?.pixCopyPaste ?? null,
          askCardUpdate: planned.askCardUpdate,
        },
      ),
    );
  });
  await flushAfterCommit(deps, fx, JOB_CONTEXT);
}

/** Active subscriptions whose next period's `charge_due_at` has passed (REC-47). */
async function dueSubscriptions(deps: JobDeps, now: Date): Promise<string[]> {
  const settings = await loadSettings(deps.db);
  const days = settings['payment.subscription_renewal_days_before'];
  const rows = await deps.db
    .select({ subscription: subscriptions, period: subscriptionPeriods })
    .from(subscriptions)
    .innerJoin(subscriptionPeriods, eq(subscriptionPeriods.subscriptionId, subscriptions.id))
    .innerJoin(users, eq(users.id, subscriptions.userId))
    .where(
      and(
        eq(subscriptions.status, 'active'),
        eq(subscriptions.autoRenew, true),
        ne(users.status, 'deleted'),
        inArray(subscriptionPeriods.status, ['active', 'upcoming']),
      ),
    )
    .orderBy(asc(subscriptions.id), desc(subscriptionPeriods.seq));
  const latest = new Map<string, PeriodRow>();
  for (const row of rows) {
    if (!latest.has(row.subscription.id)) latest.set(row.subscription.id, row.period);
  }
  const due: string[] = [];
  for (const [id, period] of latest) {
    const dueAt =
      period.status === 'upcoming'
        ? period.chargeDueAt
        : chargeDueAt(period.endsOn as LocalDate, days);
    if (dueAt.getTime() <= now.getTime()) due.push(id);
  }
  return due;
}

async function renewDue(deps: JobDeps, now: Date, stats: Record<string, number>): Promise<void> {
  const ids = await dueSubscriptions(deps, now);
  for (let i = 0; i < ids.length; i += BATCH) {
    for (const id of ids.slice(i, i + BATCH)) {
      const fx = newAfterCommit();
      const planned = await deps.db.transaction(async (tx) => {
        const subscription = await lockSubscription(tx, id);
        if (subscription.status !== 'active') return null;
        const period = await createRenewalPeriod(tx, id, now);
        if (period?.status !== 'awaiting_payment' || period.renewalAttempts > 0) return null;
        stats['renewalsCreated'] = (stats['renewalsCreated'] ?? 0) + 1;
        const result = await chargeRenewal(tx, subscription, period, 1, now, fx);
        return result === null ? null : { subscription, period, result };
      });
      await flushAfterCommit(deps, fx, JOB_CONTEXT);
      if (planned !== null) {
        stats['charges'] = (stats['charges'] ?? 0) + 1;
        await submitAndNotify(deps, planned.subscription, planned.period, planned.result);
      }
    }
  }
}

/** REC-50: one saved-card retry on the next daily run before `starts_on`. */
async function retryDeclined(deps: JobDeps, now: Date, stats: Record<string, number>) {
  const today = todayOf(now);
  const candidates = await deps.db
    .select({ subscription: subscriptions, period: subscriptionPeriods })
    .from(subscriptionPeriods)
    .innerJoin(subscriptions, eq(subscriptions.id, subscriptionPeriods.subscriptionId))
    .where(
      and(
        eq(subscriptions.status, 'active'),
        eq(subscriptionPeriods.status, 'awaiting_payment'),
        eq(subscriptionPeriods.renewalAttempts, 1),
      ),
    )
    .orderBy(asc(subscriptionPeriods.id));
  for (const { subscription, period } of candidates) {
    if (period.startsOn <= today) continue;
    const [last] = await deps.db
      .select()
      .from(charges)
      .where(
        and(
          eq(charges.subscriptionPeriodId, period.id),
          eq(charges.idempotencyKey, `renewal:${period.id}:1`),
        ),
      );
    if (last?.method !== 'saved_card' || last.status !== 'rejected') continue;
    if (todayOf(last.createdAt) >= today) continue;
    const fx = newAfterCommit();
    let planned: Planned | null = null;
    try {
      planned = await deps.db.transaction(async (tx) => {
        const locked = await lockSubscription(tx, subscription.id);
        if (locked.status !== 'active') return null;
        const [fresh] = await tx
          .select()
          .from(subscriptionPeriods)
          .where(eq(subscriptionPeriods.id, period.id))
          .for('update');
        if (fresh?.status !== 'awaiting_payment' || fresh.renewalAttempts >= MAX_ATTEMPTS) {
          return null;
        }
        return chargeRenewal(tx, locked, fresh, 2, now, fx);
      });
    } catch (error) {
      if (uniqueViolationConstraint(error) === undefined) throw error;
    }
    await flushAfterCommit(deps, fx, JOB_CONTEXT);
    if (planned !== null) {
      stats['retries'] = (stats['retries'] ?? 0) + 1;
      await submitAndNotify(deps, subscription, period, planned);
    }
  }
}

/** REC-51: one `subscription.renewal_reminder` per local day while a Pix renewal is pending. */
async function pixReminders(deps: JobDeps, now: Date, stats: Record<string, number>) {
  const today = todayOf(now);
  const rows = await deps.db
    .select({ subscription: subscriptions, period: subscriptionPeriods, charge: charges })
    .from(charges)
    .innerJoin(subscriptionPeriods, eq(subscriptionPeriods.id, charges.subscriptionPeriodId))
    .innerJoin(subscriptions, eq(subscriptions.id, subscriptionPeriods.subscriptionId))
    .where(
      and(
        eq(charges.purpose, 'subscription_renewal'),
        eq(charges.method, 'pix'),
        eq(charges.status, 'pending'),
        eq(subscriptionPeriods.status, 'awaiting_payment'),
        eq(subscriptions.status, 'active'),
      ),
    )
    .orderBy(asc(charges.id));
  for (const { subscription, period, charge } of rows) {
    if (period.startsOn <= today || todayOf(charge.createdAt) >= today) continue;
    const fx = newAfterCommit();
    await deps.db.transaction(async (tx) => {
      const user = await subscriberOf(tx, subscription.userId);
      const id = await revenueMailer['subscription.renewal_reminder'](
        tx,
        { to: user.email, dedupeKey: `renewal_reminder:${period.id}:${today}` },
        {
          name: user.name,
          categoryName: await categoryName(tx, subscription),
          link: new URL(
            `/app/compras/assinaturas/${subscription.id}/pagar`,
            deps.env.APP_BASE_URL,
          ).toString(),
          amountCents: charge.amountCents,
          dueOn: period.startsOn as LocalDate,
          method: 'pix',
          pixCopyPaste: charge.pixCopyPaste,
        },
      );
      fx.emailIds.push(id);
    });
    await flushAfterCommit(deps, fx, JOB_CONTEXT);
    stats['reminders'] = (stats['reminders'] ?? 0) + 1;
  }
}

/** REC-58: `subscription.period_ending` 7 and 1 days before `ends_on` of an active hour period. */
async function periodEndingNotices(deps: JobDeps, now: Date, stats: Record<string, number>) {
  const today = todayOf(now);
  const rows = await deps.db
    .select({ subscription: subscriptions, period: subscriptionPeriods })
    .from(subscriptionPeriods)
    .innerJoin(subscriptions, eq(subscriptions.id, subscriptionPeriods.subscriptionId))
    .where(
      and(
        eq(subscriptions.type, 'hour_package'),
        eq(subscriptions.status, 'active'),
        eq(subscriptionPeriods.status, 'active'),
        isNull(subscriptions.switchedToSubscriptionId),
      ),
    )
    .orderBy(asc(subscriptionPeriods.id));
  for (const { subscription, period } of rows) {
    const [seven, one] = periodEndNoticeDates(period.endsOn as LocalDate, [7, 1]);
    const daysLeft = today === seven ? 7 : today === one ? 1 : null;
    if (daysLeft === null) continue;
    const fx = newAfterCommit();
    await deps.db.transaction(async (tx) => {
      const user = await subscriberOf(tx, subscription.userId);
      fx.emailIds.push(
        await revenueMailer['subscription.period_ending'](
          tx,
          { to: user.email, dedupeKey: `period_ending:${period.id}:${String(daysLeft)}` },
          {
            name: user.name,
            categoryName: await categoryName(tx, subscription),
            link: new URL('/app/compras', deps.env.APP_BASE_URL).toString(),
            endsOn: period.endsOn as LocalDate,
            daysLeft,
            remainingMinutes: period.minutesBalance ?? 0,
          },
        ),
      );
    });
    await flushAfterCommit(deps, fx, JOB_CONTEXT);
    stats['notices'] = (stats['notices'] ?? 0) + 1;
  }
}

export const renewals: Job = async (deps, now) => {
  const stats: Record<string, number> = {
    renewalsCreated: 0,
    charges: 0,
    retries: 0,
    reminders: 0,
    notices: 0,
  };
  await renewDue(deps, now, stats);
  await retryDeclined(deps, now, stats);
  await pixReminders(deps, now, stats);
  await periodEndingNotices(deps, now, stats);
  return stats;
};
