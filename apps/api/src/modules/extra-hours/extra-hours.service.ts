import {
  chargeStatusLabel,
  formatBRL,
  vPacCents,
  type ChargeStatus,
  type ExtraHoursPurchaseInput,
  type ExtraHoursPurchaseResult,
  type ExtraHoursSummary,
  type PurchaseHistoryItem,
} from '@bravo/core';
import { and, asc, desc, eq, gt, lte, sql } from 'drizzle-orm';
import type { Db, Tx } from '../../db/client';
import {
  bookingCategories,
  bookings,
  charges,
  extraHoursPurchases,
  extraMinuteLots,
  subscriptionPeriods,
  subscriptions,
} from '../../db/schema';
import { getEnv } from '../../env';
import type { ChargeEffects, ChargeHandler, ChargeRow } from '../../extensions/registry';
import { audit, type RequestContext } from '../../lib/audit';
import { decodeCursor, encodeCursor } from '../../lib/cursor';
import { AppError, validationFailed } from '../../lib/errors';
import { flushAfterCommit, newAfterCommit, type AfterCommit } from '../booking/effects';
import { applyCredits } from '../credits/credits.service';
import { createLot } from '../packages/minutes.service';
import {
  cancelCharge,
  createCharge,
  submitCharge,
  type PayMethod,
  type PaymentDeps,
} from '../payments/charges.service';
import { requestRefund } from '../payments/refunds.service';
import { addDaysToInstant } from '../revenue/instants';
import { loadSettings } from '../settings/settings.repo';
import { returnCredits } from '../subscriptions/late-refund';
import { subscriberOf } from '../subscriptions/occurrences.service';
import { assertGatewayReady, assertRecurringCard } from '../subscriptions/purchase.service';
import { revenueMailer } from '../subscriptions/revenue-mailer';

// Extra hours (REC-62..REC-66, REC-70): 1..20 h at the V_pac of the active hour-package period,
// paid like any purchase (credits, then a charge); the approval creates a lot valid for
// `payment.extra_hours_validity_days`. Plus the tenant's purchase history (REC-145).

type PurchaseRow = typeof extraHoursPurchases.$inferSelect;

export const NOT_ELIGIBLE =
  'Horas extras são exclusivas para assinantes de um pacote de horas ativo.';

/** The user's `active` hour package with its `active` period, or null. */
async function activeHourPackage(db: Db | Tx, userId: string) {
  const [row] = await db
    .select({ subscription: subscriptions, period: subscriptionPeriods })
    .from(subscriptions)
    .innerJoin(subscriptionPeriods, eq(subscriptionPeriods.subscriptionId, subscriptions.id))
    .where(
      and(
        eq(subscriptions.userId, userId),
        eq(subscriptions.type, 'hour_package'),
        eq(subscriptions.status, 'active'),
        eq(subscriptionPeriods.status, 'active'),
      ),
    )
    .limit(1);
  return row ?? null;
}

const unitPriceOf = (snapshot: unknown): number => {
  const s = snapshot as { priceCents?: number; includedMinutes?: number } | null;
  return vPacCents({ priceCents: s?.priceCents ?? 0, includedMinutes: s?.includedMinutes ?? 1 });
};

/** `GET /app/extra-hours` (REC-62, REC-63). */
export async function extraHoursSummary(
  db: Db | Tx,
  userId: string,
  now: Date,
): Promise<ExtraHoursSummary> {
  const settings = await loadSettings(db);
  const live = await activeHourPackage(db, userId);
  const lots = await db
    .select()
    .from(extraMinuteLots)
    .where(
      and(
        eq(extraMinuteLots.userId, userId),
        gt(extraMinuteLots.minutesRemaining, 0),
        gt(extraMinuteLots.expiresAt, now),
      ),
    )
    .orderBy(asc(extraMinuteLots.expiresAt), asc(extraMinuteLots.createdAt));
  return {
    eligible: live !== null,
    ...(live === null
      ? { reason: NOT_ELIGIBLE }
      : { unitPriceCents: unitPriceOf(live.period.priceSnapshot) }),
    minHours: settings['payment.extra_hours_min'],
    maxHours: settings['payment.extra_hours_max'],
    lots: lots.map((lot) => ({
      id: lot.id,
      source: lot.source as ExtraHoursSummary['lots'][number]['source'],
      minutesGranted: lot.minutesGranted,
      minutesRemaining: lot.minutesRemaining,
      expiresAt: lot.expiresAt.toISOString(),
    })),
    totalRemainingMinutes: lots.reduce((sum, lot) => sum + lot.minutesRemaining, 0),
  };
}

export const toPurchaseView = (row: PurchaseRow): ExtraHoursPurchaseResult['purchase'] => ({
  id: row.id,
  hours: row.hours,
  unitPriceCents: row.unitPriceCents,
  totalCents: row.totalCents,
  status: row.status as ExtraHoursPurchaseResult['purchase']['status'],
});

/**
 * `paid`, a lot of `hours × 60` minutes expiring at `paid_at + payment.extra_hours_validity_days`
 * with its `grant` entry, and `extra_hours.purchased` (REC-66). False when not awaiting payment.
 */
async function markPaid(
  tx: Tx,
  ctx: RequestContext,
  purchaseId: string,
  now: Date,
  fx: ChargeEffects,
): Promise<boolean> {
  const [paid] = await tx
    .update(extraHoursPurchases)
    .set({ status: 'paid', paidAt: now, holdExpiresAt: null })
    .where(
      and(
        eq(extraHoursPurchases.id, purchaseId),
        eq(extraHoursPurchases.status, 'awaiting_payment'),
      ),
    )
    .returning();
  if (paid === undefined) return false;
  const settings = await loadSettings(tx);
  const expiresAt = addDaysToInstant(now, settings['payment.extra_hours_validity_days']);
  await createLot(tx, ctx, {
    userId: paid.userId,
    minutes: paid.hours * 60,
    source: 'purchase',
    expiresAt,
    purchaseId: paid.id,
    now,
  });
  const user = await subscriberOf(tx, paid.userId);
  fx.emailIds.push(
    await revenueMailer['extra_hours.purchased'](
      tx,
      { to: user.email, dedupeKey: `extra_hours.purchased:${paid.id}` },
      {
        name: user.name,
        link: new URL('/app/compras/horas-extras', getEnv().APP_BASE_URL).toString(),
        hours: paid.hours,
        amountCents: paid.totalCents,
        expiresAt,
      },
    ),
  );
  return true;
}

/** `POST /app/extra-hours` (REC-63..REC-65, REC-115). */
export async function purchaseExtraHours(
  deps: PaymentDeps,
  ctx: RequestContext,
  args: { userId: string; body: ExtraHoursPurchaseInput },
): Promise<{ purchase: PurchaseRow; charge: ChargeRow | null }> {
  const now = deps.now();
  const { body } = args;
  const method: PayMethod = body.paymentMethod;
  await assertGatewayReady(deps, method);
  const fx = newAfterCommit();
  const result = await deps.db.transaction(async (tx) => {
    const settings = await loadSettings(tx);
    const min = settings['payment.extra_hours_min'];
    const max = settings['payment.extra_hours_max'];
    if (!Number.isInteger(body.hours) || body.hours < min || body.hours > max) {
      throw validationFailed([
        { path: ['hours'], message: `Escolha de ${String(min)} a ${String(max)} horas` },
      ]);
    }
    const live = await activeHourPackage(tx, args.userId);
    if (live === null) throw new AppError(422, 'POLICY_VIOLATION', NOT_ELIGIBLE);
    const savedCardId =
      method === 'saved_card' ? await assertRecurringCard(tx, args.userId, body.savedCardId) : null;
    const unit = unitPriceOf(live.period.priceSnapshot);
    const hold = new Date(now.getTime() + settings['payment.checkout_hold_minutes'] * 60_000);
    const [purchase] = await tx
      .insert(extraHoursPurchases)
      .values({
        userId: args.userId,
        subscriptionId: live.subscription.id,
        hours: body.hours,
        unitPriceCents: unit,
        totalCents: unit * body.hours,
        status: 'awaiting_payment',
        holdExpiresAt: hold,
        createdAt: now,
      })
      .returning();
    if (purchase === undefined) throw new Error('extra hours purchase: no row');
    const credit =
      body.useCredits === true
        ? await applyCredits(tx, ctx, {
            userId: args.userId,
            amountCents: purchase.totalCents,
            purpose: 'extra_hours',
            purchaseId: purchase.id,
            now,
          })
        : { usedCents: 0, chargeId: null };
    const payNow = purchase.totalCents - credit.usedCents;
    if (payNow === 0) {
      await markPaid(tx, ctx, purchase.id, now, fx);
      const [paid] = await tx
        .select()
        .from(extraHoursPurchases)
        .where(eq(extraHoursPurchases.id, purchase.id));
      return { purchase: paid ?? purchase, charge: null };
    }
    const charge = await createCharge(tx, ctx, {
      purpose: 'extra_hours',
      userId: args.userId,
      amountCents: payNow,
      method,
      ...(savedCardId !== null && { savedCardId }),
      expiresAt: hold,
      extraHoursPurchaseId: purchase.id,
    });
    return { purchase, charge };
  });
  await flushAfterCommit(deps, fx, ctx);
  if (result.charge === null) return result;
  const charge = await submitCharge(deps, result.charge.id, {
    description: `Horas extras (${String(result.purchase.hours)} h)`,
    returnUrl: '/app/compras/horas-extras',
  });
  const [purchase] = await deps.db
    .select()
    .from(extraHoursPurchases)
    .where(eq(extraHoursPurchases.id, result.purchase.id));
  return { purchase: purchase ?? result.purchase, charge };
}

/** `extra_hours` charges (REC-66): approval pays the purchase; a late one is refunded in full. */
export const extraHoursHandler: ChargeHandler = {
  async onApproved(tx, ctx, charge, effects) {
    const fx = effects ?? { emailIds: [], staff: [], refundIds: [] };
    if (charge.extraHoursPurchaseId === null) return;
    const now = charge.approvedAt ?? charge.updatedAt;
    if (await markPaid(tx, ctx, charge.extraHoursPurchaseId, now, fx)) return;
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
      after: { why: 'extra_hours_not_awaiting', refundId: refund.id },
    });
    const user = await subscriberOf(tx, charge.userId);
    fx.emailIds.push(
      await revenueMailer['payment.late_refund'](
        tx,
        { to: user.email, dedupeKey: `payment.late_refund:${charge.id}` },
        {
          name: user.name,
          link: new URL('/app/compras/horas-extras', getEnv().APP_BASE_URL).toString(),
          amountCents: charge.amountCents,
          description: 'Horas extras',
        },
      ),
    );
  },
  // A refused payment keeps the hold; the expiry job cancels the purchase (REC-70).
  onFailed: () => Promise.resolve(),
};

/**
 * REC-70: an unpaid purchase past its hold becomes `cancelled`, its pending charge `cancelled` and
 * the credits it used are returned. Guarded: returns false when it is no longer awaiting payment.
 */
export async function expireExtraHoursPurchase(
  tx: Tx,
  ctx: RequestContext,
  purchaseId: string,
  now: Date,
  fx: AfterCommit,
): Promise<boolean> {
  const [cancelled] = await tx
    .update(extraHoursPurchases)
    .set({ status: 'cancelled' })
    .where(
      and(
        eq(extraHoursPurchases.id, purchaseId),
        eq(extraHoursPurchases.status, 'awaiting_payment'),
        lte(extraHoursPurchases.holdExpiresAt, now),
      ),
    )
    .returning();
  if (cancelled === undefined) return false;
  const pending = await tx
    .select({ id: charges.id })
    .from(charges)
    .where(and(eq(charges.extraHoursPurchaseId, purchaseId), eq(charges.status, 'pending')));
  for (const { id } of pending) {
    const row = await cancelCharge(tx, ctx, id);
    if (row !== null) fx.cancelCharges.push(row);
  }
  await returnCredits(tx, ctx, { purchaseId }, now);
  return true;
}

/** Purchases awaiting payment whose hold passed. */
export async function expiredExtraHoursPurchases(db: Db | Tx, now: Date): Promise<string[]> {
  const rows = await db
    .select({ id: extraHoursPurchases.id })
    .from(extraHoursPurchases)
    .where(
      and(
        eq(extraHoursPurchases.status, 'awaiting_payment'),
        lte(extraHoursPurchases.holdExpiresAt, now),
      ),
    )
    .orderBy(asc(extraHoursPurchases.id));
  return rows.map((r) => r.id);
}

const HISTORY_PAGE_SIZE = 50;
const BOOKING_LABEL: Record<string, string> = {
  booking_deposit: 'Reserva',
  booking_full: 'Reserva',
  booking_balance: 'Saldo da reserva',
  booking_difference: 'Diferença de reagendamento',
};

/** `GET /app/purchases/history` (REC-145): the user's charges, newest first. */
export async function purchaseHistory(
  db: Db | Tx,
  userId: string,
  cursor: string | undefined,
): Promise<{ items: PurchaseHistoryItem[]; nextCursor: string | null }> {
  const after = cursor === undefined ? undefined : decodeCursor(cursor);
  const rows = await db
    .select({
      charge: charges,
      bookingCode: bookings.code,
      categoryName: bookingCategories.name,
      periodSeq: subscriptionPeriods.seq,
      hours: extraHoursPurchases.hours,
    })
    .from(charges)
    .leftJoin(bookings, eq(bookings.id, charges.bookingId))
    .leftJoin(subscriptionPeriods, eq(subscriptionPeriods.id, charges.subscriptionPeriodId))
    .leftJoin(subscriptions, eq(subscriptions.id, subscriptionPeriods.subscriptionId))
    .leftJoin(bookingCategories, eq(bookingCategories.id, subscriptions.categoryId))
    .leftJoin(extraHoursPurchases, eq(extraHoursPurchases.id, charges.extraHoursPurchaseId))
    .where(
      and(
        eq(charges.userId, userId),
        after === undefined
          ? undefined
          : sql`(${charges.createdAt}, ${charges.id}) < (${after.at.toISOString()}::timestamptz, ${after.id}::uuid)`,
      ),
    )
    .orderBy(desc(charges.createdAt), desc(charges.id))
    .limit(HISTORY_PAGE_SIZE + 1);
  const page = rows.slice(0, HISTORY_PAGE_SIZE);
  const describe = (r: (typeof rows)[number]): string => {
    const label = BOOKING_LABEL[r.charge.purpose];
    if (label !== undefined) return `${label} ${r.bookingCode ?? ''}`.trim();
    if (r.charge.purpose === 'extra_hours') return `Horas extras (${String(r.hours ?? 0)} h)`;
    if (r.charge.purpose === 'subscription_renewal') {
      return `Renovação ${r.categoryName ?? ''}`.trim();
    }
    if (r.charge.purpose === 'subscription_initial') {
      return `Assinatura ${r.categoryName ?? ''}`.trim();
    }
    return `Pagamento ${formatBRL(r.charge.amountCents)}`;
  };
  const last = page.at(-1);
  return {
    items: page.map((r) => ({
      chargeId: r.charge.id,
      at: r.charge.createdAt.toISOString(),
      description: describe(r),
      purpose: r.charge.purpose as PurchaseHistoryItem['purpose'],
      method: r.charge.method as PurchaseHistoryItem['method'],
      amountCents: r.charge.amountCents,
      refundedCents: r.charge.refundedCents,
      status: r.charge.status as PurchaseHistoryItem['status'],
      statusLabel: chargeStatusLabel[r.charge.status as ChargeStatus],
    })),
    nextCursor:
      rows.length > HISTORY_PAGE_SIZE && last !== undefined
        ? encodeCursor({ at: last.charge.createdAt, id: last.charge.id })
        : null,
  };
}
