import { and, eq, inArray } from 'drizzle-orm';
import type { Tx } from '../../db/client';
import { bookingCategories, charges } from '../../db/schema';
import { getEnv } from '../../env';
import type { ChargeEffects, ChargeRow } from '../../extensions/registry';
import { audit, type RequestContext } from '../../lib/audit';
import { refundCredit } from '../credits/credits.service';
import { requestRefund } from '../payments/refunds.service';
import { subscriberOf } from './occurrences.service';
import { revenueMailer } from './revenue-mailer';
import type { SubscriptionRow } from './transitions';

/** Returns the credits applied to a period that will not be served (REC-18, REC-70, REC-109). */
export async function returnCredits(
  tx: Tx,
  ctx: RequestContext,
  ref: { periodId?: string; purchaseId?: string },
  now: Date,
): Promise<number> {
  const used = await tx
    .select()
    .from(charges)
    .where(
      and(
        eq(charges.method, 'credit'),
        ref.periodId === undefined ? undefined : eq(charges.subscriptionPeriodId, ref.periodId),
        ref.purchaseId === undefined ? undefined : eq(charges.extraHoursPurchaseId, ref.purchaseId),
        inArray(charges.status, ['approved', 'partially_refunded']),
      ),
    );
  let returned = 0;
  for (const charge of used) {
    const left = charge.amountCents - charge.refundedCents;
    if (left <= 0) continue;
    returned += (await refundCredit(tx, ctx, { chargeId: charge.id, amountCents: left, now }))
      .refundedCents;
  }
  return returned;
}

/** Name of the subscription's category (e-mails). */
export async function categoryName(tx: Tx, subscription: SubscriptionRow): Promise<string> {
  const [row] = await tx
    .select({ name: bookingCategories.name })
    .from(bookingCategories)
    .where(eq(bookingCategories.id, subscription.categoryId));
  return row?.name ?? '';
}

/**
 * The money has nothing left to pay (REC-19, REC-78): full refund `late_approval_conflict`, audit
 * and `payment.late_refund`. The refund is submitted after commit through `fx.refundIds`.
 */
export async function refundLate(
  tx: Tx,
  ctx: RequestContext,
  charge: ChargeRow,
  subscription: SubscriptionRow,
  fx: ChargeEffects,
  why: string,
): Promise<void> {
  const refund = await requestRefund(tx, {
    chargeId: charge.id,
    amountCents: charge.amountCents,
    reason: 'late_approval_conflict',
    ctx,
  });
  fx.refundIds.push(refund.id);
  await audit(tx, ctx, {
    action: 'payment.refund_unusable',
    entityType: 'charge',
    entityId: charge.id,
    after: { why, refundId: refund.id, amountCents: charge.amountCents },
  });
  const user = await subscriberOf(tx, subscription.userId);
  fx.emailIds.push(
    await revenueMailer['payment.late_refund'](
      tx,
      { to: user.email, dedupeKey: `payment.late_refund:${charge.id}` },
      {
        name: user.name,
        link: new URL('/app/compras', getEnv().APP_BASE_URL).toString(),
        amountCents: charge.amountCents,
        description: `Assinatura ${await categoryName(tx, subscription)}`,
      },
    ),
  );
}
