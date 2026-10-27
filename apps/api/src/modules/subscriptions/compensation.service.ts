import {
  addDays,
  fixedScheduleCompensationCents,
  hourPackageCompensationMinutes,
  localToUtc,
  type Cents,
  type LocalDate,
} from '@bravo/core';
import { and, eq, gt, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { Db, Tx } from '../../db/client';
import {
  bookingCategories,
  bookings,
  closedDayCompensations,
  closedDays,
  subscriptionPeriods,
  subscriptions,
  users,
} from '../../db/schema';
import type { CompensationSummary } from '../../extensions/registry';
import type { RequestContext } from '../../lib/audit';
import { transitionBooking } from '../booking/transition';
import { grantCredit } from '../credits/credits.service';
import { createLot } from '../packages/minutes.service';
import { addDaysToInstant } from '../revenue/instants';
import { loadSettings } from '../settings/settings.repo';
import { revenueMailer } from './revenue-mailer';

// Closed-day compensation (PRD §5.2, REC-97..REC-104): an hour package gets an extra-minute lot
// of included ÷ period days for a clinic-wide closure; a fixed schedule gets a credit of period
// price ÷ period days for a closure of the clinic or of its room, and its occurrences on that date
// are cancelled by the clinic. One compensation per (closed day, subscription).

type PeriodDays = 30 | 60 | 90;

interface Candidate {
  subscriptionId: string;
  type: 'hour_package' | 'fixed_schedule';
  roomId: string | null;
  userId: string;
  periodId: string;
  periodDays: PeriodDays;
  priceCents: Cents;
  includedMinutes: number | null;
  categoryName: string;
  email: string;
  name: string;
}

/** Subscriptions whose `active` or `paid` period covers `date` and the closure reaches. */
async function candidatesFor(
  db: Db | Tx,
  date: LocalDate,
  roomIds: string[] | null,
): Promise<Candidate[]> {
  const rows = await db
    .select({
      subscriptionId: subscriptions.id,
      type: subscriptions.type,
      roomId: subscriptions.roomId,
      userId: subscriptions.userId,
      periodDays: subscriptions.periodDays,
      periodId: subscriptionPeriods.id,
      priceCents: subscriptionPeriods.priceCents,
      includedMinutes: subscriptionPeriods.includedMinutes,
      categoryName: bookingCategories.name,
      email: users.email,
      name: users.name,
    })
    .from(subscriptionPeriods)
    .innerJoin(subscriptions, eq(subscriptions.id, subscriptionPeriods.subscriptionId))
    .innerJoin(bookingCategories, eq(bookingCategories.id, subscriptions.categoryId))
    .innerJoin(users, eq(users.id, subscriptions.userId))
    .where(
      and(
        inArray(subscriptionPeriods.status, ['active', 'paid']),
        lte(subscriptionPeriods.startsOn, date),
        gt(subscriptionPeriods.endsOn, date),
        inArray(subscriptions.status, ['active', 'suspended']),
      ),
    )
    .orderBy(subscriptions.id);
  return rows
    .filter((row) =>
      row.type === 'hour_package'
        ? roomIds === null
        : roomIds === null || (row.roomId !== null && roomIds.includes(row.roomId)),
    )
    .map((row) => ({
      ...row,
      type: row.type as Candidate['type'],
      periodDays: row.periodDays as PeriodDays,
    }));
}

const amountOf = (c: Candidate) =>
  c.type === 'hour_package'
    ? { minutes: hourPackageCompensationMinutes(c.includedMinutes ?? 0, c.periodDays), cents: 0 }
    : { minutes: 0, cents: fixedScheduleCompensationCents(c.priceCents, c.periodDays) };

/** Fixed occurrences on `date` (local) a closure cancels: confirmed and held for renewal. */
async function occurrencesOn(db: Db | Tx, date: LocalDate, roomIds: string[] | null) {
  return db
    .select({ id: bookings.id, status: bookings.status })
    .from(bookings)
    .where(
      and(
        eq(bookings.kind, 'fixed_occurrence'),
        inArray(bookings.status, ['confirmed', 'held_for_renewal']),
        sql`${bookings.startsAt} >= ${localToUtc(date, 0).toISOString()}::timestamptz`,
        sql`${bookings.startsAt} < ${localToUtc(addDays(date, 1), 0).toISOString()}::timestamptz`,
        roomIds === null ? undefined : inArray(bookings.roomId, roomIds),
      ),
    )
    .orderBy(bookings.id);
}

/** = nucleo `ClosedDayCompensationPort.preview` (REC-97): what closing `date` would grant. */
export async function previewClosedDay(
  db: Db | Tx,
  args: { date: LocalDate; roomIds: string[] | null },
): Promise<CompensationSummary> {
  const settings = await loadSettings(db);
  const occurrences = await occurrencesOn(db, args.date, args.roomIds);
  if (!settings['payment.closed_day_compensation_enabled']) {
    return {
      subscribers: 0,
      minutes: 0,
      creditCents: 0,
      fixedOccurrencesCancelled: occurrences.length,
    };
  }
  const candidates = await candidatesFor(db, args.date, args.roomIds);
  let minutes = 0;
  let creditCents = 0;
  for (const candidate of candidates) {
    const amount = amountOf(candidate);
    minutes += amount.minutes;
    creditCents += amount.cents;
  }
  return {
    subscribers: candidates.length,
    minutes,
    creditCents,
    fixedOccurrencesCancelled: occurrences.length,
  };
}

/** One compensation, written only when the (closed day, subscription) pair is new (REC-104). */
async function compensate(
  tx: Tx,
  ctx: RequestContext,
  closed: { id: string; date: LocalDate },
  candidate: Candidate,
  now: Date,
  appBaseUrl: string,
): Promise<boolean> {
  const amount = amountOf(candidate);
  if (amount.minutes <= 0 && amount.cents <= 0) return false;
  const [row] = await tx
    .insert(closedDayCompensations)
    .values({
      closedDayId: closed.id,
      subscriptionId: candidate.subscriptionId,
      periodId: candidate.periodId,
      kind: candidate.type === 'hour_package' ? 'minutes' : 'credit',
      minutes: amount.minutes > 0 ? amount.minutes : null,
      amountCents: amount.cents > 0 ? amount.cents : null,
      createdAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: closedDayCompensations.id });
  if (row === undefined) return false;

  if (candidate.type === 'hour_package') {
    const settings = await loadSettings(tx);
    const lot = await createLot(tx, ctx, {
      userId: candidate.userId,
      minutes: amount.minutes,
      source: 'closed_day_compensation',
      expiresAt: addDaysToInstant(now, settings['payment.extra_hours_validity_days']),
      detail: { closedDayId: closed.id, date: closed.date },
      now,
    });
    await tx
      .update(closedDayCompensations)
      .set({ extraMinuteLotId: lot.id })
      .where(eq(closedDayCompensations.id, row.id));
  } else {
    const lot = await grantCredit(tx, ctx, {
      userId: candidate.userId,
      amountCents: amount.cents,
      source: 'closed_day_compensation',
      refType: 'closed_day',
      refId: closed.id,
      now,
    });
    await tx
      .update(closedDayCompensations)
      .set({ creditLotId: lot.id })
      .where(eq(closedDayCompensations.id, row.id));
  }
  await revenueMailer['subscription.compensation'](
    tx,
    {
      to: candidate.email,
      dedupeKey: `subscription.compensation:${closed.id}:${candidate.subscriptionId}`,
    },
    {
      name: candidate.name,
      categoryName: candidate.categoryName,
      link: new URL('/app/compras', appBaseUrl).toString(),
      closedOn: closed.date,
      ...(amount.minutes > 0 ? { minutes: amount.minutes } : { creditCents: amount.cents }),
    },
  );
  return true;
}

/**
 * = nucleo `ClosedDayCompensationPort.apply` (REC-98..REC-101, REC-103, REC-104): cancels the fixed
 * occurrences of each new closed day and compensates the reached subscriptions once.
 */
export async function applyClosedDay(
  tx: Tx,
  closedDayIds: string[],
  ctx: RequestContext,
  opts: { now: Date; appBaseUrl: string },
): Promise<{ compensations: number; occurrencesCancelled: number }> {
  if (closedDayIds.length === 0) return { compensations: 0, occurrencesCancelled: 0 };
  const settings = await loadSettings(tx);
  const days = await tx
    .select()
    .from(closedDays)
    .where(inArray(closedDays.id, closedDayIds))
    .orderBy(closedDays.id);
  let compensations = 0;
  let occurrencesCancelled = 0;
  for (const day of days) {
    const date = day.date as LocalDate;
    const roomIds = day.roomId === null ? null : [day.roomId];
    for (const occurrence of await occurrencesOn(tx, date, roomIds)) {
      await transitionBooking(
        tx,
        ctx,
        occurrence.id,
        ['confirmed', 'held_for_renewal'],
        'cancelled_by_clinic',
        'closed_day',
        { closedDayId: day.id },
        { cancelledAt: opts.now, cancelReason: 'closed_day', cancelledBy: ctx.actorUserId },
      );
      occurrencesCancelled += 1;
    }
    if (!settings['payment.closed_day_compensation_enabled']) continue;
    for (const candidate of await candidatesFor(tx, date, roomIds)) {
      if (await compensate(tx, ctx, { id: day.id, date }, candidate, opts.now, opts.appBaseUrl)) {
        compensations += 1;
      }
    }
  }
  return { compensations, occurrencesCancelled };
}

/**
 * Clinic-wide closed days already inside an hour-package period when it becomes active (REC-102),
 * each compensated once. Returns how many compensations were written.
 */
export async function compensateKnownClosedDays(
  tx: Tx,
  periodId: string,
  ctx: RequestContext,
  opts: { now: Date; appBaseUrl: string },
): Promise<number> {
  const settings = await loadSettings(tx);
  if (!settings['payment.closed_day_compensation_enabled']) return 0;
  const [period] = await tx
    .select({ period: subscriptionPeriods, type: subscriptions.type })
    .from(subscriptionPeriods)
    .innerJoin(subscriptions, eq(subscriptions.id, subscriptionPeriods.subscriptionId))
    .where(eq(subscriptionPeriods.id, periodId));
  if (period?.type !== 'hour_package') return 0;
  const days = await tx
    .select()
    .from(closedDays)
    .where(
      and(
        isNull(closedDays.roomId),
        sql`${closedDays.date} >= ${period.period.startsOn}`,
        sql`${closedDays.date} < ${period.period.endsOn}`,
      ),
    )
    .orderBy(closedDays.date);
  let written = 0;
  for (const day of days) {
    const date = day.date as LocalDate;
    const candidate = (await candidatesFor(tx, date, null)).find((c) => c.periodId === periodId);
    if (candidate === undefined) continue;
    if (await compensate(tx, ctx, { id: day.id, date }, candidate, opts.now, opts.appBaseUrl)) {
      written += 1;
    }
  }
  return written;
}
