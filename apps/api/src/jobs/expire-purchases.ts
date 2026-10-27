import { and, asc, eq, inArray, lte } from 'drizzle-orm';
import type { Tx } from '../db/client';
import { charges, subscriptionPeriods, subscriptions } from '../db/schema';
import { flushAfterCommit, newAfterCommit, type AfterCommit } from '../modules/booking/effects';
import { releaseUse } from '../modules/coupons/coupons.service';
import {
  expireExtraHoursPurchase,
  expiredExtraHoursPurchases,
} from '../modules/extra-hours/extra-hours.service';
import { cancelCharge } from '../modules/payments/charges.service';
import { returnCredits } from '../modules/subscriptions/late-refund';
import { occurrencesOf, transitionOccurrences } from '../modules/subscriptions/occurrences.service';
import {
  lockSubscription,
  transitionPeriod,
  transitionSubscription,
} from '../modules/subscriptions/transitions';
import { JOB_CONTEXT, type Job } from './runner';

// Every 5 minutes (REC-18, REC-70): subscriptions and extra-hours purchases whose checkout or
// sale-link hold passed unpaid expire. A subscription becomes `expired` with its period cancelled,
// its occurrences expired (occupancy released), the coupon use released, the credits returned and
// the pending charge cancelled; a pending switch leaves the old subscription as it was (REC-75).

/** REC-18 for one subscription; false when it is no longer an expired hold. */
export async function expireSubscriptionHold(
  tx: Tx,
  subscriptionId: string,
  now: Date,
  fx: AfterCommit,
): Promise<boolean> {
  const current = await lockSubscription(tx, subscriptionId);
  if (
    current.status !== 'awaiting_payment' ||
    current.holdExpiresAt === null ||
    current.holdExpiresAt > now
  ) {
    return false;
  }
  await transitionSubscription(tx, subscriptionId, ['awaiting_payment'], 'expired', now);
  const periods = await tx
    .select()
    .from(subscriptionPeriods)
    .where(eq(subscriptionPeriods.subscriptionId, subscriptionId));
  for (const period of periods) {
    const pending = await tx
      .select({ id: charges.id })
      .from(charges)
      .where(and(eq(charges.subscriptionPeriodId, period.id), eq(charges.status, 'pending')));
    for (const { id } of pending) {
      const cancelled = await cancelCharge(tx, JOB_CONTEXT, id);
      if (cancelled !== null) fx.cancelCharges.push(cancelled);
    }
    await returnCredits(tx, JOB_CONTEXT, { periodId: period.id }, now);
    if (period.status === 'awaiting_payment') {
      await transitionPeriod(tx, period.id, ['awaiting_payment'], 'cancelled', now);
    }
  }
  const held = await occurrencesOf(tx, subscriptionId, ['awaiting_payment', 'pre_reserved']);
  await transitionOccurrences(tx, JOB_CONTEXT, held, 'expired', 'subscription_hold_expired', now);
  await releaseUse(tx, { subscriptionId }, now);
  return true;
}

export const expirePurchases: Job = async (deps, now) => {
  const due = await deps.db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(
      and(
        inArray(subscriptions.status, ['awaiting_payment']),
        lte(subscriptions.holdExpiresAt, now),
      ),
    )
    .orderBy(asc(subscriptions.id));
  let subscriptionsExpired = 0;
  for (const { id } of due) {
    const fx = newAfterCommit();
    if (await deps.db.transaction((tx) => expireSubscriptionHold(tx, id, now, fx))) {
      subscriptionsExpired += 1;
    }
    await flushAfterCommit(deps, fx, JOB_CONTEXT);
  }
  let purchasesCancelled = 0;
  for (const id of await expiredExtraHoursPurchases(deps.db, now)) {
    const fx = newAfterCommit();
    if (await deps.db.transaction((tx) => expireExtraHoursPurchase(tx, JOB_CONTEXT, id, now, fx))) {
      purchasesCancelled += 1;
    }
    await flushAfterCommit(deps, fx, JOB_CONTEXT);
  }
  return { subscriptionsExpired, purchasesCancelled };
};
