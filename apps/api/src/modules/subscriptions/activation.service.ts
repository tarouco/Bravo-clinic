import { and, eq } from 'drizzle-orm';
import type { Tx } from '../../db/client';
import { bookingCategories, rooms, subscriptionPeriods } from '../../db/schema';
import type { ChargeEffects } from '../../extensions/registry';
import type { RequestContext } from '../../lib/audit';
import { consumeUse } from '../coupons/coupons.service';
import { loadSettings } from '../settings/settings.repo';
import {
  occurrencesIcs,
  occurrencesOf,
  subscriberOf,
  transitionOccurrences,
} from './occurrences.service';
import { activatePeriod, todayOf } from './period.service';
import { revenueMailer } from './revenue-mailer';
import { lockSubscription, transitionPeriod, transitionSubscription } from './transitions';

// First payment of a subscription (REC-15, REC-16, REC-88, REC-124, REC-152, REC-160): the
// subscription becomes `active`, its first period `active` (base date reached) or `paid`, the
// fixed occurrences `confirmed`, the coupon use consumed; one e-mail and one staff notice.

export interface ActivationOptions {
  now: Date;
  appBaseUrl: string;
  fx: ChargeEffects;
}

/** Activates an `awaiting_payment` subscription; false (and nothing written) for any other status. */
export async function activateSubscription(
  tx: Tx,
  ctx: RequestContext,
  subscriptionId: string,
  opts: ActivationOptions,
): Promise<boolean> {
  const current = await lockSubscription(tx, subscriptionId);
  if (current.status !== 'awaiting_payment') return false;
  const { now } = opts;
  const subscription = await transitionSubscription(
    tx,
    subscriptionId,
    ['awaiting_payment'],
    'active',
    now,
    { holdExpiresAt: null },
  );
  const [first] = await tx
    .select()
    .from(subscriptionPeriods)
    .where(
      and(
        eq(subscriptionPeriods.subscriptionId, subscriptionId),
        eq(subscriptionPeriods.status, 'awaiting_payment'),
      ),
    )
    .orderBy(subscriptionPeriods.seq)
    .limit(1);
  if (first === undefined) throw new Error('activateSubscription: no awaiting period');
  const period =
    first.startsOn <= todayOf(now)
      ? await activatePeriod(tx, ctx, first.id, opts)
      : await transitionPeriod(tx, first.id, ['awaiting_payment'], 'paid', now, { paidAt: now });

  const held = await occurrencesOf(tx, subscriptionId, ['awaiting_payment', 'pre_reserved']);
  const confirmed = await transitionOccurrences(
    tx,
    ctx,
    held,
    'confirmed',
    'subscription_paid',
    now,
  );
  await consumeUse(tx, { subscriptionId }, now);

  const [category] = await tx
    .select({ name: bookingCategories.name })
    .from(bookingCategories)
    .where(eq(bookingCategories.id, subscription.categoryId));
  const [room] =
    subscription.roomId === null
      ? []
      : await tx.select({ name: rooms.name }).from(rooms).where(eq(rooms.id, subscription.roomId));
  const user = await subscriberOf(tx, subscription.userId);
  const settings = await loadSettings(tx);
  opts.fx.emailIds.push(
    await revenueMailer['subscription.activated'](
      tx,
      {
        to: user.email,
        dedupeKey: `subscription.activated:${subscription.id}`,
        ...(confirmed.length > 0 && {
          attachments: [
            await occurrencesIcs(tx, confirmed, { address: settings['clinic.address_line'], now }),
          ],
        }),
      },
      {
        name: user.name,
        categoryName: category?.name ?? '',
        link: new URL('/app/compras', opts.appBaseUrl).toString(),
        startsOn: period.startsOn as `${number}-${number}-${number}`,
        endsOn: period.endsOn as `${number}-${number}-${number}`,
        priceCents: period.priceCents - period.discountCents,
        ...(period.includedMinutes !== null && { includedMinutes: period.includedMinutes }),
        ...(room !== undefined && { roomName: room.name }),
        ...(confirmed.length > 0 && {
          occurrences: confirmed.map((b) => ({ startsAt: b.startsAt, endsAt: b.endsAt })),
        }),
      },
    ),
  );
  opts.fx.staff.push({
    event: 'new_subscription',
    payload: { entityId: subscription.id, categoryName: category?.name ?? '' },
  });
  return true;
}
