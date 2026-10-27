import {
  addDays,
  extraLotSourceLabel,
  formatDebitDetail,
  ledgerEntryLabel,
  occurrenceConflictLabel,
  utcToLocal,
  type ExtraLotSource,
  type LedgerEntry,
  type LedgerPage,
  type LocalDate,
  type OccurrenceConflictReason,
  type PackageLedgerEntryType,
  type Period,
  type Subscription,
} from '@bravo/core';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db, Tx } from '../../db/client';
import {
  bookingCategories,
  bookings,
  extraMinuteLots,
  extraMinutesLedger,
  packageLedger,
  rooms,
  savedCards,
  subscriptionPeriods,
  subscriptions,
} from '../../db/schema';
import { validationFailed } from '../../lib/errors';
import { extraMinutesAvailable } from '../packages/minutes.service';
import { loadSettings } from '../settings/settings.repo';
import type { PeriodRow, SubscriptionRow } from './transitions';

// The `Subscription`, `Period` and `LedgerPage` contracts (design.md "API Contracts", REC-41,
// REC-42, REC-143) shared by the tenant and admin routes.

const PENDING_PERIODS = ['paid', 'awaiting_payment'];
const NEXT_PERIODS = ['upcoming', 'awaiting_payment', 'paid'];
const LIVE_OCCURRENCES = ['confirmed', 'awaiting_payment', 'pre_reserved'];

export function toPeriodView(period: PeriodRow): Period {
  const conflicts = (period.heldConflicts as { date: LocalDate; reason: string }[] | null) ?? [];
  return {
    id: period.id,
    seq: period.seq,
    startsOn: period.startsOn as LocalDate,
    endsOn: period.endsOn as LocalDate,
    status: period.status as Period['status'],
    priceCents: period.priceCents,
    discountCents: period.discountCents,
    ...(period.occurrenceCount !== null && { occurrenceCount: period.occurrenceCount }),
    ...(period.minutesBalance !== null && { minutesBalance: period.minutesBalance }),
    ...(conflicts.length > 0 && {
      heldConflicts: conflicts.map((c) => ({
        date: c.date,
        label: occurrenceConflictLabel(c.reason as OccurrenceConflictReason),
      })),
    }),
  };
}

/** The period in force (active, else the first one paid or awaiting) and the one after it. */
function currentAndNext(periods: PeriodRow[]): {
  current: PeriodRow | null;
  next: PeriodRow | null;
} {
  const sorted = [...periods].sort((a, b) => a.seq - b.seq);
  const current =
    sorted.find((p) => p.status === 'active') ??
    sorted.find((p) => PENDING_PERIODS.includes(p.status)) ??
    sorted.at(-1) ??
    null;
  const next =
    current === null
      ? null
      : (sorted.find((p) => p.seq === current.seq + 1 && NEXT_PERIODS.includes(p.status)) ?? null);
  return { current, next };
}

/** The `Subscription` contract of one row (REC-143). */
export async function toSubscriptionView(
  db: Db | Tx,
  subscription: SubscriptionRow,
  now: Date,
): Promise<Subscription> {
  const [category] = await db
    .select()
    .from(bookingCategories)
    .where(eq(bookingCategories.id, subscription.categoryId));
  const [room] =
    subscription.roomId === null
      ? []
      : await db.select().from(rooms).where(eq(rooms.id, subscription.roomId));
  const periods = await db
    .select()
    .from(subscriptionPeriods)
    .where(eq(subscriptionPeriods.subscriptionId, subscription.id));
  const { current, next } = currentAndNext(periods);
  const settings = await loadSettings(db);

  let nextCharge: Subscription['nextCharge'] = null;
  if (subscription.status === 'active' && current !== null && subscription.autoRenew) {
    const due = next?.chargeDueAt ?? null;
    const on =
      due === null
        ? addDays(
            current.endsOn as LocalDate,
            -settings['payment.subscription_renewal_days_before'],
          )
        : utcToLocal(due).date;
    const amountCents =
      next !== null && next.priceCents > 0
        ? next.priceCents - next.discountCents
        : subscription.type === 'hour_package'
          ? (category?.fixedPriceCents ?? 0)
          : (category?.pricePerOccurrenceCents ?? 0) * (current.occurrenceCount ?? 0);
    let cardLast4: string | undefined;
    if (subscription.paymentMethod === 'saved_card' && subscription.savedCardId !== null) {
      const [card] = await db
        .select({ last4: savedCards.last4 })
        .from(savedCards)
        .where(eq(savedCards.id, subscription.savedCardId));
      cardLast4 = card?.last4 ?? undefined;
    }
    nextCharge = {
      on,
      amountCents,
      method: subscription.paymentMethod as 'saved_card' | 'pix',
      ...(cardLast4 !== undefined && { cardLast4 }),
    };
  }

  const view: Subscription = {
    id: subscription.id,
    status: subscription.status as Subscription['status'],
    type: subscription.type as Subscription['type'],
    category: { id: subscription.categoryId, name: category?.name ?? '' },
    ...(room !== undefined && { room: { id: room.id, name: room.name } }),
    baseOn: subscription.baseOn as LocalDate,
    periodDays: subscription.periodDays as 30 | 60 | 90,
    currentPeriod: current === null ? null : toPeriodView(current),
    nextPeriod: next === null ? null : toPeriodView(next),
    ...(subscription.status === 'awaiting_payment' &&
      subscription.holdExpiresAt !== null && {
        holdExpiresAt: subscription.holdExpiresAt.toISOString(),
      }),
    nextCharge,
  };
  if (subscription.type === 'hour_package') {
    view.balance = {
      packageMinutes: current?.status === 'active' ? (current.minutesBalance ?? 0) : 0,
      includedMinutes: current?.includedMinutes ?? category?.includedMinutes ?? 0,
      extraMinutes: await extraMinutesAvailable(db, subscription.userId, now),
    };
  } else {
    const upcoming =
      current === null
        ? []
        : await db
            .select({ startsAt: bookings.startsAt, endsAt: bookings.endsAt })
            .from(bookings)
            .where(
              and(
                eq(bookings.subscriptionId, subscription.id),
                eq(bookings.subscriptionPeriodId, current.id),
                inArray(bookings.status, LIVE_OCCURRENCES),
                sql`${bookings.startsAt} > ${now.toISOString()}::timestamptz`,
              ),
            )
            .orderBy(asc(bookings.startsAt));
    const first = upcoming[0];
    view.occurrences = {
      remainingInPeriod: upcoming.length,
      ...(first !== undefined && {
        next: { startsAt: first.startsAt.toISOString(), endsAt: first.endsAt.toISOString() },
      }),
    };
  }
  return view;
}

/** The user's subscriptions, newest first. */
export async function listSubscriptionViews(
  db: Db | Tx,
  userId: string,
  now: Date,
): Promise<Subscription[]> {
  const rows = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .orderBy(desc(subscriptions.createdAt), desc(subscriptions.id));
  const out: Subscription[] = [];
  for (const row of rows) out.push(await toSubscriptionView(db, row, now));
  return out;
}

// ---- Extrato (REC-41, REC-42) ----

const LEDGER_PAGE_SIZE = 50;

interface LedgerCursor {
  at: Date;
  key: string;
}

const encodeLedgerCursor = (c: LedgerCursor) =>
  Buffer.from(JSON.stringify([c.at.toISOString(), c.key]), 'utf8').toString('base64url');

function decodeLedgerCursor(raw: string): LedgerCursor {
  const invalid = () => validationFailed([{ path: ['cursor'], message: 'Cursor inválido' }]);
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (!Array.isArray(parsed) || typeof parsed[0] !== 'string' || typeof parsed[1] !== 'string') {
      throw invalid();
    }
    const at = new Date(parsed[0]);
    if (Number.isNaN(at.getTime()) || !/^[pe]:\d+$/.test(parsed[1])) throw invalid();
    return { at, key: parsed[1] };
  } catch {
    throw invalid();
  }
}

/** Sort key of an entry: time, then kind and id, newest first. */
const sortKey = (e: { at: Date; key: string }) =>
  `${String(e.at.getTime()).padStart(15, '0')}|${e.key.slice(0, 1)}|${e.key.slice(2).padStart(15, '0')}`;

const detailTextOf = (detail: unknown): string | undefined => {
  const d = detail as { durationMinutes?: unknown; debitMinutes?: unknown } | null;
  return typeof d?.durationMinutes === 'number' && typeof d.debitMinutes === 'number'
    ? formatDebitDetail({ durationMinutes: d.durationMinutes, debitMinutes: d.debitMinutes })
    : undefined;
};

/**
 * Extrato of a subscription: its package entries and the user's extra-minute entries, newest
 * first, each with its label, signed minutes, balance after it, booking code and the debit
 * formula ("60 min + 18 min de excedente = 78 min").
 */
export async function subscriptionLedger(
  db: Db | Tx,
  subscription: SubscriptionRow,
  cursor: string | undefined,
): Promise<LedgerPage> {
  const after = cursor === undefined ? null : decodeLedgerCursor(cursor);
  const packageRows = await db
    .select({
      id: packageLedger.id,
      at: packageLedger.createdAt,
      entryType: packageLedger.entryType,
      minutes: packageLedger.minutes,
      detail: packageLedger.detail,
      seq: subscriptionPeriods.seq,
      bookingCode: bookings.code,
      balanceAfter: sql<number>`(sum(${packageLedger.minutes}) over (partition by ${packageLedger.periodId} order by ${packageLedger.id}))::int`,
    })
    .from(packageLedger)
    .innerJoin(subscriptionPeriods, eq(subscriptionPeriods.id, packageLedger.periodId))
    .leftJoin(bookings, eq(bookings.id, packageLedger.bookingId))
    .where(eq(packageLedger.subscriptionId, subscription.id));
  const extraRows = await db
    .select({
      id: extraMinutesLedger.id,
      at: extraMinutesLedger.createdAt,
      entryType: extraMinutesLedger.entryType,
      minutes: extraMinutesLedger.minutes,
      detail: extraMinutesLedger.detail,
      source: extraMinuteLots.source,
      expiresAt: extraMinuteLots.expiresAt,
      bookingCode: bookings.code,
      balanceAfter: sql<number>`(sum(${extraMinutesLedger.minutes}) over (partition by ${extraMinutesLedger.lotId} order by ${extraMinutesLedger.id}))::int`,
    })
    .from(extraMinutesLedger)
    .innerJoin(extraMinuteLots, eq(extraMinuteLots.id, extraMinutesLedger.lotId))
    .leftJoin(bookings, eq(bookings.id, extraMinutesLedger.bookingId))
    .where(eq(extraMinutesLedger.userId, subscription.userId));

  interface Row {
    entry: LedgerEntry;
    sort: string;
    key: string;
    atDate: Date;
  }
  const entries: Row[] = [
    ...packageRows.map((r): Row => {
      const key = `p:${String(r.id)}`;
      const detailText = r.entryType === 'debit' ? detailTextOf(r.detail) : undefined;
      return {
        key,
        atDate: r.at,
        sort: sortKey({ at: r.at, key }),
        entry: {
          id: key,
          at: r.at.toISOString(),
          kind: 'package',
          entryType: r.entryType as LedgerEntry['entryType'],
          label: ledgerEntryLabel(r.entryType as PackageLedgerEntryType, r.seq),
          minutes: r.minutes,
          balanceAfter: Math.max(0, r.balanceAfter),
          ...(r.bookingCode !== null && { bookingCode: r.bookingCode }),
          ...(detailText !== undefined && { detailText }),
        },
      };
    }),
    ...extraRows.map((r): Row => {
      const key = `e:${String(r.id)}`;
      const detailText = r.entryType === 'debit' ? detailTextOf(r.detail) : undefined;
      return {
        key,
        atDate: r.at,
        sort: sortKey({ at: r.at, key }),
        entry: {
          id: key,
          at: r.at.toISOString(),
          kind: 'extra',
          entryType: r.entryType as LedgerEntry['entryType'],
          label:
            r.entryType === 'grant'
              ? extraLotSourceLabel[r.source as ExtraLotSource]
              : ledgerEntryLabel(r.entryType as PackageLedgerEntryType),
          minutes: r.minutes,
          balanceAfter: Math.max(0, r.balanceAfter),
          lotExpiresAt: r.expiresAt.toISOString(),
          ...(r.bookingCode !== null && { bookingCode: r.bookingCode }),
          ...(detailText !== undefined && { detailText }),
        },
      };
    }),
  ].sort((a, b) => (a.sort < b.sort ? 1 : a.sort > b.sort ? -1 : 0));
  const bound = after === null ? null : sortKey(after);
  const remaining = bound === null ? entries : entries.filter((e) => e.sort < bound);
  const page = remaining.slice(0, LEDGER_PAGE_SIZE);
  const last = page.at(-1);
  return {
    items: page.map((row) => row.entry),
    nextCursor:
      remaining.length > LEDGER_PAGE_SIZE && last !== undefined
        ? encodeLedgerCursor({ at: last.atDate, key: last.key })
        : null,
  };
}
