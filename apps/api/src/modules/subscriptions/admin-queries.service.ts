import {
  addDays,
  subscriptionStatusLabel,
  utcToLocal,
  type AdminSubscriptionRow,
  type CouponUse,
  type CouponUseStatus,
  type LocalDate,
  type Subscription,
  type SubscriptionStatus,
} from '@bravo/core';
import { and, asc, desc, eq, gt, ilike, inArray, sql } from 'drizzle-orm';
import type { Db, Tx } from '../../db/client';
import {
  bookingCategories,
  bookings,
  couponUses,
  coupons,
  creditLots,
  extraMinuteLots,
  rooms,
  subscriptionPeriods,
  subscriptions,
  users,
} from '../../db/schema';
import { decodeCursor, encodeCursor } from '../../lib/cursor';
import { notFound } from '../../lib/errors';
import { toCreditLotView, type CreditLotView } from '../credits/credits.service';
import { formatHoursMinutes } from '../../emails/templates/revenue';
import { loadSettings } from '../settings/settings.repo';
import { listSubscriptionViews, toSubscriptionView } from './views.service';

// Admin reads of Gestão de Reservas → Assinaturas (REC-148, REC-149) and the customer reads gestao
// uses in Clientes and the LGPD export (gestao R12).

const PAGE_SIZE = 50;

export interface AdminSubscriptionFilters {
  status?: string | undefined;
  type?: string | undefined;
  search?: string | undefined;
}

/** `GET /admin/subscriptions` (REC-148): newest first, by status/type, searched by customer name. */
export async function listAdminSubscriptions(
  db: Db | Tx,
  filters: AdminSubscriptionFilters,
  cursor: string | undefined,
): Promise<{ items: AdminSubscriptionRow[]; nextCursor: string | null }> {
  const after = cursor === undefined ? undefined : decodeCursor(cursor);
  const rows = await db
    .select({
      subscription: subscriptions,
      customerName: users.name,
      categoryName: bookingCategories.name,
      roomName: rooms.name,
    })
    .from(subscriptions)
    .innerJoin(users, eq(users.id, subscriptions.userId))
    .innerJoin(bookingCategories, eq(bookingCategories.id, subscriptions.categoryId))
    .leftJoin(rooms, eq(rooms.id, subscriptions.roomId))
    .where(
      and(
        filters.status === undefined ? undefined : eq(subscriptions.status, filters.status),
        filters.type === undefined ? undefined : eq(subscriptions.type, filters.type),
        filters.search === undefined || filters.search.trim() === ''
          ? undefined
          : ilike(users.name, `%${filters.search.trim().replace(/[%_\\]/g, (m) => `\\${m}`)}%`),
        after === undefined
          ? undefined
          : sql`(${subscriptions.createdAt}, ${subscriptions.id}) < (${after.at.toISOString()}::timestamptz, ${after.id}::uuid)`,
      ),
    )
    .orderBy(desc(subscriptions.createdAt), desc(subscriptions.id))
    .limit(PAGE_SIZE + 1);
  const page = rows.slice(0, PAGE_SIZE);
  const ids = page.map((r) => r.subscription.id);
  const periods =
    ids.length === 0
      ? []
      : await db
          .select()
          .from(subscriptionPeriods)
          .where(inArray(subscriptionPeriods.subscriptionId, ids));
  const settings = await loadSettings(db);
  const days = settings['payment.subscription_renewal_days_before'];
  const items = page.map((r): AdminSubscriptionRow => {
    const s = r.subscription;
    const own = periods.filter((p) => p.subscriptionId === s.id).sort((a, b) => a.seq - b.seq);
    const active = own.find((p) => p.status === 'active');
    const next = own.find((p) => ['upcoming', 'awaiting_payment'].includes(p.status));
    const nextChargeOn =
      s.status !== 'active'
        ? undefined
        : next !== undefined
          ? utcToLocal(next.chargeDueAt).date
          : active !== undefined
            ? addDays(active.endsOn as LocalDate, -days)
            : undefined;
    const balanceText =
      s.type === 'hour_package'
        ? active === undefined
          ? '—'
          : `${formatHoursMinutes(active.minutesBalance ?? 0)} de ${formatHoursMinutes(active.includedMinutes ?? 0)}`
        : active === undefined
          ? '—'
          : `${String(active.occurrenceCount ?? 0)} ocorrências no período`;
    return {
      id: s.id,
      customer: { id: s.userId, name: r.customerName },
      category: { id: s.categoryId, name: r.categoryName },
      type: s.type as AdminSubscriptionRow['type'],
      ...(s.roomId !== null && r.roomName !== null && { room: { id: s.roomId, name: r.roomName } }),
      baseOn: s.baseOn as LocalDate,
      ...(nextChargeOn !== undefined && { nextChargeOn }),
      status: s.status as SubscriptionStatus,
      statusLabel: subscriptionStatusLabel[s.status as SubscriptionStatus],
      balanceText,
    };
  });
  const last = page.at(-1);
  return {
    items,
    nextCursor:
      rows.length > PAGE_SIZE && last !== undefined
        ? encodeCursor({ at: last.subscription.createdAt, id: last.subscription.id })
        : null,
  };
}

/** Any subscription by id (staff), or 404. */
export async function findSubscription(db: Db | Tx, id: string) {
  const [row] = await db.select().from(subscriptions).where(eq(subscriptions.id, id));
  if (row === undefined) throw notFound('NOT_FOUND', 'Assinatura não encontrada');
  return row;
}

/** `GET /admin/subscriptions/:id` (REC-149): the `Subscription` contract. */
export async function getAdminSubscription(
  db: Db | Tx,
  id: string,
  now: Date,
): Promise<Subscription> {
  return toSubscriptionView(db, await findSubscription(db, id), now);
}

/** gestao R12: every subscription of one customer. */
export const getCustomerSubscriptions = (db: Db | Tx, userId: string, now: Date) =>
  listSubscriptionViews(db, userId, now);

export interface CustomerBalances {
  periods: {
    subscriptionId: string;
    periodId: string;
    categoryName: string;
    startsOn: LocalDate;
    endsOn: LocalDate;
    minutesBalance: number;
    includedMinutes: number;
  }[];
  extraLots: {
    id: string;
    source: string;
    minutesGranted: number;
    minutesRemaining: number;
    expiresAt: string;
  }[];
  creditLots: CreditLotView[];
}

/** gestao R12: minutes of each open period, unexpired extra lots and credit lots of one user. */
export async function getCustomerBalances(
  db: Db | Tx,
  userId: string,
  now: Date,
): Promise<CustomerBalances> {
  const periods = await db
    .select({ period: subscriptionPeriods, categoryName: bookingCategories.name })
    .from(subscriptionPeriods)
    .innerJoin(subscriptions, eq(subscriptions.id, subscriptionPeriods.subscriptionId))
    .innerJoin(bookingCategories, eq(bookingCategories.id, subscriptions.categoryId))
    .where(
      and(
        eq(subscriptions.userId, userId),
        eq(subscriptions.type, 'hour_package'),
        eq(subscriptionPeriods.status, 'active'),
      ),
    )
    .orderBy(asc(subscriptionPeriods.startsOn));
  const extra = await db
    .select()
    .from(extraMinuteLots)
    .where(and(eq(extraMinuteLots.userId, userId), gt(extraMinuteLots.expiresAt, now)))
    .orderBy(asc(extraMinuteLots.expiresAt));
  const credit = await db
    .select()
    .from(creditLots)
    .where(and(eq(creditLots.userId, userId), gt(creditLots.expiresAt, now)))
    .orderBy(asc(creditLots.expiresAt));
  return {
    periods: periods.map(({ period, categoryName }) => ({
      subscriptionId: period.subscriptionId,
      periodId: period.id,
      categoryName,
      startsOn: period.startsOn as LocalDate,
      endsOn: period.endsOn as LocalDate,
      minutesBalance: period.minutesBalance ?? 0,
      includedMinutes: period.includedMinutes ?? 0,
    })),
    extraLots: extra.map((lot) => ({
      id: lot.id,
      source: lot.source,
      minutesGranted: lot.minutesGranted,
      minutesRemaining: lot.minutesRemaining,
      expiresAt: lot.expiresAt.toISOString(),
    })),
    creditLots: credit.map(toCreditLotView),
  };
}

/** gestao R12: the coupon uses of one customer, newest first (`CouponUse` plus the code). */
export async function listCouponUsesByUser(
  db: Db | Tx,
  userId: string,
): Promise<(CouponUse & { couponCode: string })[]> {
  const rows = await db
    .select({
      id: couponUses.id,
      at: couponUses.createdAt,
      code: coupons.code,
      customerName: users.name,
      bookingCode: bookings.code,
      category: bookingCategories.name,
      discountCents: couponUses.discountCents,
      status: couponUses.status,
    })
    .from(couponUses)
    .innerJoin(coupons, eq(coupons.id, couponUses.couponId))
    .innerJoin(users, eq(users.id, couponUses.userId))
    .leftJoin(bookings, eq(bookings.id, couponUses.bookingId))
    .leftJoin(subscriptions, eq(subscriptions.id, couponUses.subscriptionId))
    .leftJoin(bookingCategories, eq(bookingCategories.id, subscriptions.categoryId))
    .where(eq(couponUses.userId, userId))
    .orderBy(desc(couponUses.createdAt), desc(couponUses.id));
  return rows.map((row) => ({
    id: row.id,
    at: row.at.toISOString(),
    couponCode: row.code,
    customerName: row.customerName,
    ...(row.bookingCode !== null && { bookingCode: row.bookingCode }),
    ...(row.category !== null && { subscriptionCategory: row.category }),
    discountCents: row.discountCents,
    status: row.status as CouponUseStatus,
  }));
}
