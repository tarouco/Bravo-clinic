import { and, eq, lte } from 'drizzle-orm';
import type { Tx } from '../../db/client';
import { subscriptionPeriods } from '../../db/schema';
import { getEnv } from '../../env';
import type { ChargeEffects, ChargeHandler, ChargeRow } from '../../extensions/registry';
import type { RequestContext } from '../../lib/audit';
import { activateSubscription } from './activation.service';
import { categoryName, refundLate } from './late-refund';
import { occurrencesOf, subscriberOf, transitionOccurrences } from './occurrences.service';
import { activatePeriod, closePeriod, todayOf } from './period.service';
import { revenueMailer } from './revenue-mailer';
import { completeSwitch } from './switch.service';
import {
  lockSubscription,
  transitionPeriod,
  transitionSubscription,
  type PeriodRow,
  type SubscriptionRow,
} from './transitions';

// Receita's charge purposes in nucleo's payment effects (gap B1, REC-16, REC-19, REC-49, REC-50,
// REC-56, REC-88, REC-160). Each handler runs inside the transaction that approved or failed the
// charge; e-mails, staff notices and refunds go to `effects`, flushed after commit.

const noEffects = (): ChargeEffects => ({ emailIds: [], staff: [], refundIds: [] });

/** Approval time of the charge (the payment service's clock), for dates and ledger rows. */
const clockOf = (charge: ChargeRow): Date => charge.approvedAt ?? charge.updatedAt;

async function chargedPeriod(
  tx: Tx,
  charge: ChargeRow,
): Promise<{ period: PeriodRow; subscription: SubscriptionRow } | null> {
  if (charge.subscriptionPeriodId === null) return null;
  const [period] = await tx
    .select()
    .from(subscriptionPeriods)
    .where(eq(subscriptionPeriods.id, charge.subscriptionPeriodId))
    .for('update');
  if (period === undefined) return null;
  return { period, subscription: await lockSubscription(tx, period.subscriptionId) };
}

/** First payment (REC-16, REC-19, REC-88): activation, or a full refund when it came too late. */
export const subscriptionInitialHandler: ChargeHandler = {
  async onApproved(tx, ctx, charge, effects) {
    const fx = effects ?? noEffects();
    const found = await chargedPeriod(tx, charge);
    if (found === null) return;
    const { subscription } = found;
    if (subscription.status !== 'awaiting_payment') {
      await refundLate(tx, ctx, charge, subscription, fx, `subscription_${subscription.status}`);
      return;
    }
    if (subscription.switchFromSubscriptionId !== null) {
      await completeSwitch(tx, ctx, subscription, charge, { now: clockOf(charge), fx });
      return;
    }
    await activateSubscription(tx, ctx, subscription.id, {
      now: clockOf(charge),
      appBaseUrl: getEnv().APP_BASE_URL,
      fx,
    });
  },
  // A refused first payment keeps the hold: the tenant may pay again until it expires (REC-18).
  onFailed: () => Promise.resolve(),
};

/**
 * Renewal paid (REC-49, REC-56): the period becomes `paid` (or `active` when its base date already
 * came, which also regularizes a suspended subscription) and its held occurrences `confirmed`.
 */
export async function settleRenewal(
  tx: Tx,
  ctx: RequestContext,
  args: {
    period: PeriodRow;
    subscription: SubscriptionRow;
    now: Date;
    amountCents: number;
    fx: ChargeEffects;
  },
): Promise<void> {
  const { period, subscription, now, fx } = args;
  const appBaseUrl = getEnv().APP_BASE_URL;
  let settled: PeriodRow;
  if (period.startsOn <= todayOf(now) || subscription.status === 'suspended') {
    if (subscription.status === 'suspended') {
      await transitionSubscription(tx, subscription.id, ['suspended'], 'active', now, {
        suspendedAt: null,
      });
    }
    const ended = await tx
      .select({ id: subscriptionPeriods.id })
      .from(subscriptionPeriods)
      .where(
        and(
          eq(subscriptionPeriods.subscriptionId, subscription.id),
          eq(subscriptionPeriods.status, 'active'),
          lte(subscriptionPeriods.endsOn, period.startsOn),
        ),
      );
    for (const old of ended) await closePeriod(tx, ctx, old.id, now);
    settled = await activatePeriod(tx, ctx, period.id, { now, appBaseUrl, fx });
  } else {
    settled = await transitionPeriod(tx, period.id, ['awaiting_payment'], 'paid', now, {
      paidAt: now,
    });
  }
  const held = await occurrencesOf(tx, subscription.id, ['held_for_renewal'], {
    periodId: period.id,
  });
  await transitionOccurrences(tx, ctx, held, 'confirmed', 'renewal_paid', now);
  const user = await subscriberOf(tx, subscription.userId);
  fx.emailIds.push(
    await revenueMailer['subscription.renewal_approved'](
      tx,
      { to: user.email, dedupeKey: `renewal_approved:${period.id}` },
      {
        name: user.name,
        categoryName: await categoryName(tx, subscription),
        link: new URL('/app/compras', appBaseUrl).toString(),
        amountCents: args.amountCents,
        startsOn: settled.startsOn as `${number}-${number}-${number}`,
        endsOn: settled.endsOn as `${number}-${number}-${number}`,
      },
    ),
  );
}

/** Renewal charges (REC-49, REC-50, REC-56, REC-160). */
export const subscriptionRenewalHandler: ChargeHandler = {
  async onApproved(tx, ctx, charge, effects) {
    const fx = effects ?? noEffects();
    const found = await chargedPeriod(tx, charge);
    if (found === null) return;
    const { period, subscription } = found;
    const payable =
      period.status === 'awaiting_payment' && ['active', 'suspended'].includes(subscription.status);
    if (!payable) {
      await refundLate(tx, ctx, charge, subscription, fx, `period_${period.status}`);
      return;
    }
    await settleRenewal(tx, ctx, {
      period,
      subscription,
      now: clockOf(charge),
      amountCents: charge.amountCents,
      fx,
    });
  },
  async onFailed(tx, _ctx, charge, status, effects) {
    if (status !== 'rejected') return;
    const fx = effects ?? noEffects();
    const found = await chargedPeriod(tx, charge);
    if (found === null) return;
    const { period, subscription } = found;
    const user = await subscriberOf(tx, subscription.userId);
    const name = await categoryName(tx, subscription);
    fx.emailIds.push(
      await revenueMailer['subscription.renewal_failed'](
        tx,
        {
          to: user.email,
          dedupeKey: `renewal_failed:${period.id}:${String(period.renewalAttempts)}:${charge.id}`,
        },
        {
          name: user.name,
          categoryName: name,
          link: new URL(
            `/app/compras/assinaturas/${subscription.id}/pagar`,
            getEnv().APP_BASE_URL,
          ).toString(),
          amountCents: charge.amountCents,
          dueOn: period.startsOn as `${number}-${number}-${number}`,
        },
      ),
    );
    fx.staff.push({
      event: 'renewal_failed',
      payload: { entityId: subscription.id, periodId: period.id, chargeId: charge.id },
    });
  },
};
