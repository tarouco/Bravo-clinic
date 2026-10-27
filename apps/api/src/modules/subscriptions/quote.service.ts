import {
  addDays,
  averageHourlyCents,
  businessWindow,
  type BusinessHoursRow,
  baseOnRangeMessage,
  estimateFixedPeriod,
  findOccurrenceConflicts,
  fixedPeriodPriceCents,
  generateOccurrences,
  occurrenceConflictLabel,
  periodBounds,
  periodDaysOf,
  utcToLocal,
  vPacCents,
  type LocalDate,
  type Occupied,
  type OccurrenceCheck,
  type OccurrenceConflict,
  type PackageOffer,
  type SubscriptionQuote,
  type SubscriptionQuoteInput,
} from '@bravo/core';
import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import type { Db, Tx } from '../../db/client';
import { bookingCategories, rooms } from '../../db/schema';
import { notFound, validationFailed } from '../../lib/errors';
import { loadBusinessHours, loadDayContexts, type DayContext } from '../calendar/calendar.repo';
import { evaluateCoupon } from '../coupons/coupons.service';
import { availableCredit } from '../credits/credits.service';
import { loadSettings } from '../settings/settings.repo';

// Package offers, the fixed-schedule occurrence check and the subscription quote (REC-07, REC-08,
// REC-10, REC-11, REC-84, REC-89, REC-155). Reads only.

type CategoryRow = typeof bookingCategories.$inferSelect;
type PackagePeriod = 'monthly' | 'bimonthly' | 'quarterly';

const SUGGESTION_DAYS = 14;
const MAX_SUGGESTIONS = 3;

/** Active public package categories, by display order (REC-07, REC-08, REC-155). */
export async function listPackageOffers(db: Db | Tx): Promise<PackageOffer[]> {
  const rows = await db
    .select()
    .from(bookingCategories)
    .where(
      and(
        inArray(bookingCategories.type, ['hour_package', 'fixed_schedule']),
        eq(bookingCategories.status, 'active'),
        eq(bookingCategories.visibility, 'public'),
      ),
    )
    .orderBy(asc(bookingCategories.displayOrder), asc(bookingCategories.createdAt));
  return rows.map(toOffer);
}

function toOffer(row: CategoryRow): PackageOffer {
  const period = row.period as PackagePeriod;
  const periodDays = periodDaysOf(period);
  const base = { id: row.id, name: row.name, period, periodDays };
  if (row.type === 'hour_package') {
    const priceCents = row.fixedPriceCents ?? 0;
    const includedMinutes = row.includedMinutes ?? 0;
    return {
      type: 'hour_package',
      ...base,
      priceCents,
      includedMinutes,
      avgHourCents: averageHourlyCents({ priceCents, minutes: includedMinutes }),
    };
  }
  const pricePerOccurrenceCents = row.pricePerOccurrenceCents ?? 0;
  return {
    type: 'fixed_schedule',
    ...base,
    pricePerOccurrenceCents,
    weekdays: row.weekdays,
    startMinute: row.startMinute,
    endMinute: row.endMinute,
    avgHourCents: averageHourlyCents({
      priceCents: pricePerOccurrenceCents,
      minutes: row.endMinute - row.startMinute,
    }),
    estimate: estimateFixedPeriod({ weekdays: row.weekdays, periodDays, pricePerOccurrenceCents }),
  };
}

/**
 * A purchasable package category: active, and public unless the admin sells it (REC-07, REC-08).
 * Anything else is a 404.
 */
export async function loadPackageCategory(
  db: Db | Tx,
  id: string,
  opts: { includeAdminOnly?: boolean; type?: 'hour_package' | 'fixed_schedule' } = {},
): Promise<CategoryRow> {
  const [row] = await db
    .select()
    .from(bookingCategories)
    .where(
      and(
        eq(bookingCategories.id, id),
        inArray(
          bookingCategories.type,
          opts.type === undefined ? ['hour_package', 'fixed_schedule'] : [opts.type],
        ),
        eq(bookingCategories.status, 'active'),
        opts.includeAdminOnly === true ? undefined : eq(bookingCategories.visibility, 'public'),
      ),
    );
  if (row === undefined) throw notFound('NOT_FOUND', 'Pacote não encontrado');
  return row;
}

/** REC-11: `today ≤ baseOn ≤ today + calendar.max_advance_days`, else 422 on `baseOn`. */
export function assertBaseOn(baseOn: LocalDate, now: Date, maxAdvanceDays: number): void {
  const today = utcToLocal(now).date;
  const limit = addDays(today, maxAdvanceDays);
  if (baseOn < today || baseOn > limit) {
    throw validationFailed([{ path: ['baseOn'], message: baseOnRangeMessage(today, limit) }]);
  }
}

export interface FixedPlan {
  occurrences: { date: LocalDate; startsAt: Date; endsAt: Date }[];
  conflicts: OccurrenceConflict[];
  startsOn: LocalDate;
  endsOn: LocalDate;
  periodPriceCents: number;
}

/** Occupied intervals of all contexts, without the duplicates of intervals spanning two dates. */
function occupiedOf(contexts: Map<LocalDate, DayContext>): Occupied[] {
  const seen = new Set<string>();
  const out: Occupied[] = [];
  for (const context of contexts.values()) {
    for (const item of context.occupied) {
      const key = `${String(item.start.getTime())}-${String(item.occupiedUntil.getTime())}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

/** The occurrences of one period of `category` from `baseOn` in `roomId`, with their conflicts. */
export function planFixedPeriod(
  category: CategoryRow,
  roomId: string,
  baseOn: LocalDate,
  contexts: Map<LocalDate, DayContext>,
  settings: { cleanupMinutes: number; notBefore: Date; hours: BusinessHoursRow[] },
): FixedPlan {
  const periodDays = periodDaysOf(category.period as PackagePeriod);
  const { startsOn, endsOn } = periodBounds(baseOn, periodDays);
  const occurrences = generateOccurrences({
    baseOn,
    periodDays,
    weekdays: category.weekdays,
    startMinute: category.startMinute,
    endMinute: category.endMinute,
    notBefore: settings.notBefore,
  });
  // SPEC_DEVIATION: an open holiday keeps the weekday's business hours for a fixed schedule.
  // Reason: REC-90 "holidays keep their occurrences (the clinic opens by default)"; with the
  // holiday hours (09:00) the PRD example (Meio turno 07:00–09:30 from 2026-11-02, 22 occurrences)
  // would conflict on Finados and Consciência Negra.
  const windows = new Map(
    occurrences.map((o) => {
      const context = contexts.get(o.date);
      const window =
        context?.window != null && context.isHoliday
          ? businessWindow({
              date: o.date,
              roomId,
              hours: settings.hours,
              holidays: [],
              closedDays: [],
            })
          : (context?.window ?? null);
      return [
        o.date,
        window === null ? null : { openMinute: window.openMinute, closeMinute: window.closeMinute },
      ];
    }),
  );
  const conflicts = findOccurrenceConflicts(occurrences, {
    closedDays: [],
    roomId,
    occupied: occupiedOf(contexts),
    cleanupMinutes: settings.cleanupMinutes,
    windows,
  }).map((c) => ({ ...c, label: occurrenceConflictLabel(c.reason) }));
  return {
    occurrences,
    conflicts,
    startsOn,
    endsOn,
    periodPriceCents: fixedPeriodPriceCents(
      category.pricePerOccurrenceCents ?? 0,
      occurrences.length,
    ),
  };
}

const datesFrom = (from: LocalDate, days: number): LocalDate[] =>
  Array.from({ length: days }, (_, i) => addDays(from, i));

async function activeRoom(db: Db | Tx, roomId: string) {
  const [room] = await db
    .select()
    .from(rooms)
    .where(and(eq(rooms.id, roomId), eq(rooms.status, 'active')));
  if (room === undefined)
    throw validationFailed([{ path: ['roomId'], message: 'Sala não encontrada' }]);
  return room;
}

/**
 * REC-84, REC-89: occurrences, conflicts with labels and the period price; with conflicts, up to 3
 * other active rooms free for the same base date and up to 3 conflict-free base dates in the next
 * 14 days in the chosen room.
 */
export async function checkOccurrences(
  db: Db | Tx,
  args: {
    categoryId: string;
    roomId: string;
    baseOn: LocalDate;
    now: Date;
    includeAdminOnly?: boolean;
  },
): Promise<OccurrenceCheck> {
  const category = await loadPackageCategory(db, args.categoryId, {
    type: 'fixed_schedule',
    ...(args.includeAdminOnly !== undefined && { includeAdminOnly: args.includeAdminOnly }),
  });
  await activeRoom(db, args.roomId);
  const values = await loadSettings(db);
  assertBaseOn(args.baseOn, args.now, values['calendar.max_advance_days']);
  const settings = {
    cleanupMinutes: values['calendar.cleanup_minutes'],
    notBefore: new Date(args.now.getTime() + values['calendar.min_advance_minutes'] * 60_000),
    hours: await loadBusinessHours(db),
  };
  const periodDays = periodDaysOf(category.period as PackagePeriod);
  const span = datesFrom(args.baseOn, periodDays + SUGGESTION_DAYS + 1);
  const contexts = await loadDayContexts(db, { roomId: args.roomId, dates: span, now: args.now });
  const plan = planFixedPeriod(category, args.roomId, args.baseOn, contexts, settings);

  const suggestions: OccurrenceCheck['suggestions'] = { rooms: [], baseDates: [] };
  if (plan.conflicts.length > 0) {
    const others = await db
      .select({ id: rooms.id, name: rooms.name })
      .from(rooms)
      .where(and(eq(rooms.status, 'active'), ne(rooms.id, args.roomId)))
      .orderBy(asc(rooms.displayOrder));
    for (const room of others) {
      if (suggestions.rooms.length >= MAX_SUGGESTIONS) break;
      const roomContexts = await loadDayContexts(db, {
        roomId: room.id,
        dates: datesFrom(args.baseOn, periodDays),
        now: args.now,
      });
      if (
        planFixedPeriod(category, room.id, args.baseOn, roomContexts, settings).conflicts.length ===
        0
      ) {
        suggestions.rooms.push({ roomId: room.id, roomName: room.name });
      }
    }
    for (
      let day = 1;
      day <= SUGGESTION_DAYS && suggestions.baseDates.length < MAX_SUGGESTIONS;
      day += 1
    ) {
      const candidate = addDays(args.baseOn, day);
      if (
        planFixedPeriod(category, args.roomId, candidate, contexts, settings).conflicts.length === 0
      ) {
        suggestions.baseDates.push(candidate);
      }
    }
  }
  return {
    startsOn: plan.startsOn,
    endsOn: plan.endsOn,
    occurrences: plan.occurrences.map((o) => ({
      date: o.date,
      startsAt: o.startsAt.toISOString(),
      endsAt: o.endsAt.toISOString(),
    })),
    conflicts: plan.conflicts,
    periodPriceCents: plan.periodPriceCents,
    suggestions,
  };
}

/**
 * The first payment of a subscription (REC-10, REC-11, REC-125): period dates, renewal and
 * charge dates, price (hour package or per occurrence × count), coupon on the first payment only,
 * credits, and pay-now.
 */
export async function quoteSubscription(
  db: Db | Tx,
  args: { userId: string; input: SubscriptionQuoteInput; now: Date; includeAdminOnly?: boolean },
): Promise<SubscriptionQuote> {
  const { input, now } = args;
  const category = await loadPackageCategory(db, input.categoryId, {
    ...(args.includeAdminOnly !== undefined && { includeAdminOnly: args.includeAdminOnly }),
  });
  const settings = await loadSettings(db);
  assertBaseOn(input.baseOn, now, settings['calendar.max_advance_days']);
  const periodDays = periodDaysOf(category.period as PackagePeriod);
  const { startsOn, endsOn } = periodBounds(input.baseOn, periodDays);
  const renewalDaysBefore = settings['payment.subscription_renewal_days_before'];

  let priceCents: number;
  let extra: Partial<SubscriptionQuote> = {};
  if (category.type === 'hour_package') {
    priceCents = category.fixedPriceCents ?? 0;
    const includedMinutes = category.includedMinutes ?? 0;
    extra = { includedMinutes, vPacCents: vPacCents({ priceCents, includedMinutes }) };
  } else {
    if (input.roomId === undefined) {
      throw validationFailed([{ path: ['roomId'], message: 'Escolha a sala' }]);
    }
    await activeRoom(db, input.roomId);
    const contexts = await loadDayContexts(db, {
      roomId: input.roomId,
      dates: datesFrom(input.baseOn, periodDays),
      now,
    });
    const plan = planFixedPeriod(category, input.roomId, input.baseOn, contexts, {
      cleanupMinutes: settings['calendar.cleanup_minutes'],
      notBefore: new Date(now.getTime() + settings['calendar.min_advance_minutes'] * 60_000),
      hours: await loadBusinessHours(db),
    });
    priceCents = plan.periodPriceCents;
    extra = { occurrenceCount: plan.occurrences.length, conflicts: plan.conflicts };
  }

  let discountCents = 0;
  let couponRejection: SubscriptionQuote['couponRejection'];
  if (input.couponCode !== undefined) {
    const evaluation = await evaluateCoupon(db, {
      code: input.couponCode,
      userId: args.userId,
      target: 'package',
      grossCents: priceCents,
      now,
    });
    if (evaluation.ok) discountCents = evaluation.discountCents;
    else couponRejection = { reason: evaluation.reason, message: evaluation.message };
  }
  const creditAvailableCents = await availableCredit(db, args.userId, now);
  const payable = priceCents - discountCents;
  const creditAppliedCents =
    input.useCredits === true ? Math.min(creditAvailableCents, payable) : 0;
  return {
    startsOn,
    endsOn,
    renewsOn: endsOn,
    chargeDueOn: addDays(endsOn, -renewalDaysBefore),
    priceCents,
    ...extra,
    discountCents,
    ...(couponRejection !== undefined && { couponRejection }),
    creditAvailableCents,
    creditAppliedCents,
    payNowCents: payable - creditAppliedCents,
  };
}
