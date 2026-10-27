import {
  fixedScheduleCategoryInput,
  hourPackageCategoryInput,
  type FixedScheduleCategoryInput,
  type HourPackageCategoryInput,
  type LocalDate,
} from '@bravo/core';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Tx } from '../../db/client';
import { subscriptionPeriods, subscriptions, users } from '../../db/schema';
import { getEnv } from '../../env';
import type { CategoryHandler, CategoryRow } from '../../extensions/registry';
import { AppError, conflict } from '../../lib/errors';
import { loadSettings } from '../settings/settings.repo';
import { revenueMailer } from './revenue-mailer';

// Package categories in nucleo's category admin (REC-01, REC-02, REC-05, REC-06; gap B3).

export const LOCKED_CATEGORY_MESSAGE =
  'Categoria com assinaturas ativas: crie uma nova categoria para mudar dias, horário ou período';

const LIVE = ['awaiting_payment', 'active', 'suspended'] as const;

const invalid = (path: string, message: string) =>
  new AppError(422, 'VALIDATION_FAILED', 'Dados inválidos', [{ path, message }]);

/** Hour package: whole hours 1..200 stored as minutes, any period but `single` (REC-01). */
export const hourPackageHandler: CategoryHandler = {
  type: 'hour_package',
  schema: hourPackageCategoryInput,
  toRow(input) {
    const v = input as HourPackageCategoryInput;
    return {
      name: v.name,
      type: 'hour_package',
      fixedPriceCents: v.fixedPriceCents,
      includedMinutes: v.includedMinutes,
      period: v.period,
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      startMinute: 0,
      endMinute: 1440,
      status: v.status ?? 'active',
      visibility: v.visibility ?? 'public',
    };
  },
  onUpdate: (tx, before, after) => onPackageUpdate(tx, before, after),
};

/**
 * Fixed schedule (REC-02). The grid bounds depend on the calendar settings, so the static schema
 * checks the shape and `validateRow` checks the grid with the settings in force.
 */
export const fixedScheduleHandler: CategoryHandler = {
  type: 'fixed_schedule',
  schema: fixedScheduleCategoryInput({ slotMinutes: 1, minBookingMinutes: 1 }),
  toRow(input) {
    const v = input as FixedScheduleCategoryInput;
    return {
      name: v.name,
      type: 'fixed_schedule',
      weekdays: v.weekdays,
      startMinute: v.startMinute,
      endMinute: v.endMinute,
      pricePerOccurrenceCents: v.pricePerOccurrenceCents,
      period: v.period,
      appliesOnHolidays: true,
      status: v.status ?? 'active',
      visibility: v.visibility ?? 'public',
    };
  },
  async validateRow(tx, row) {
    const settings = await loadSettings(tx);
    const result = fixedScheduleCategoryInput({
      slotMinutes: settings['calendar.slot_minutes'],
      minBookingMinutes: settings['calendar.default_booking_minutes'],
    }).safeParse({
      type: 'fixed_schedule',
      name: row.name,
      weekdays: row.weekdays,
      startMinute: row.startMinute,
      endMinute: row.endMinute,
      pricePerOccurrenceCents: row.pricePerOccurrenceCents,
      period: row.period,
    });
    if (!result.success) {
      const issue = result.error.issues[0];
      throw invalid(
        issue?.path.map(String).join('.') ?? 'startMinute',
        issue?.message ?? 'Dados inválidos',
      );
    }
  },
  onUpdate: (tx, before, after) => onPackageUpdate(tx, before, after),
};

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The first renewal a price change reaches: the next period not priced yet (REC-06). */
function firstRenewalOn(latest: { status: string; startsOn: string; endsOn: string }): LocalDate {
  return (latest.status === 'upcoming' ? latest.startsOn : latest.endsOn) as LocalDate;
}

/**
 * REC-05: weekdays, window and period are locked while the category has live subscriptions.
 * REC-06: a price or included-minutes change e-mails every active or suspended subscriber with the
 * new value and the first renewal it applies to (nucleo bumps the version and audits the update).
 */
async function onPackageUpdate(tx: Tx, before: CategoryRow, after: CategoryRow): Promise<void> {
  const shapeChanged =
    !same(before.weekdays, after.weekdays) ||
    before.startMinute !== after.startMinute ||
    before.endMinute !== after.endMinute ||
    before.period !== after.period;
  const priceChanged =
    before.fixedPriceCents !== after.fixedPriceCents ||
    before.includedMinutes !== after.includedMinutes ||
    before.pricePerOccurrenceCents !== after.pricePerOccurrenceCents;
  if (!shapeChanged && !priceChanged) return;

  const live = await tx
    .select({
      id: subscriptions.id,
      status: subscriptions.status,
      email: users.email,
      name: users.name,
    })
    .from(subscriptions)
    .innerJoin(users, eq(users.id, subscriptions.userId))
    .where(and(eq(subscriptions.categoryId, before.id), inArray(subscriptions.status, [...LIVE])))
    .orderBy(subscriptions.id);
  if (shapeChanged && live.length > 0) throw conflict('CONFLICT', LOCKED_CATEGORY_MESSAGE);
  if (!priceChanged) return;

  const isHour = after.type === 'hour_package';
  const newPriceCents = (isHour ? after.fixedPriceCents : after.pricePerOccurrenceCents) ?? 0;
  const link = new URL('/app/compras', getEnv().APP_BASE_URL).toString();
  for (const subscriber of live) {
    if (subscriber.status === 'awaiting_payment') continue;
    const [latest] = await tx
      .select({
        status: subscriptionPeriods.status,
        startsOn: subscriptionPeriods.startsOn,
        endsOn: subscriptionPeriods.endsOn,
      })
      .from(subscriptionPeriods)
      .where(eq(subscriptionPeriods.subscriptionId, subscriber.id))
      .orderBy(desc(subscriptionPeriods.seq))
      .limit(1);
    if (latest === undefined) continue;
    await revenueMailer['subscription.price_change'](
      tx,
      {
        to: subscriber.email,
        dedupeKey: `price_change:${before.id}:${String(after.version)}:${subscriber.id}`,
      },
      {
        name: subscriber.name,
        categoryName: after.name,
        link,
        newPriceCents,
        ...(!isHour && { unit: 'por ocorrência' }),
        firstRenewalOn: firstRenewalOn(latest),
      },
    );
  }
}
