import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { users } from './identity';
import { closedDays, rooms } from './calendar';
import { bookingCategories, bookings } from './booking';
import { savedCards } from './payments';
import { coupons } from './coupons';
import { creditLots, extraMinuteLots } from './ledgers';

// Receita subscriptions (docs/architecture.md section 5.4 with the AD-030 deltas of
// .specs/features/receita/design.md "Data Models"). Instants are timestamptz, local dates `date`.
const tstz = (name: string) => timestamp(name, { withTimezone: true });
const localDate = (name: string) => date(name, { mode: 'string' });

export const SUBSCRIPTION_STATUS_SQL = sql`('awaiting_payment','active','suspended','ended','cancelled','switched','expired')`;

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => bookingCategories.id, { onDelete: 'restrict' }),
    type: text('type').notNull(),
    // Fixed schedule only.
    roomId: uuid('room_id').references(() => rooms.id, { onDelete: 'restrict' }),
    status: text('status').notNull(),
    // Current base date (a new one on switch).
    baseOn: localDate('base_on').notNull(),
    periodDays: smallint('period_days').notNull(),
    // Terms in force: { categoryVersion, priceCents?, includedMinutes?, pricePerOccurrenceCents?,
    // weekdays?, startMinute?, endMinute? }; each period keeps its own snapshot too.
    priceSnapshot: jsonb('price_snapshot').notNull(),
    paymentMethod: text('payment_method').notNull(),
    savedCardId: uuid('saved_card_id').references(() => savedCards.id, { onDelete: 'restrict' }),
    // Applies to the first payment only (REC-125).
    firstCouponId: uuid('first_coupon_id').references(() => coupons.id, { onDelete: 'restrict' }),
    autoRenew: boolean('auto_renew').notNull().default(true),
    switchedToSubscriptionId: uuid('switched_to_subscription_id').references(
      (): AnyPgColumn => subscriptions.id,
      { onDelete: 'restrict' },
    ),
    // A pending switch target points to the subscription it replaces.
    switchFromSubscriptionId: uuid('switch_from_subscription_id').references(
      (): AnyPgColumn => subscriptions.id,
      { onDelete: 'restrict' },
    ),
    // awaiting_payment only: the checkout hold or the admin sale link hold.
    holdExpiresAt: tstz('hold_expires_at'),
    saleMode: text('sale_mode').notNull().default('self'),
    source: text('source').notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }),
    suspendedAt: tstz('suspended_at'),
    endedAt: tstz('ended_at'),
    cancelledAt: tstz('cancelled_at'),
    createdAt: tstz('created_at').notNull().defaultNow(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    check('subscriptions_type_check', sql`${t.type} in ('hour_package','fixed_schedule')`),
    check('subscriptions_status_check', sql`${t.status} in ${SUBSCRIPTION_STATUS_SQL}`),
    check('subscriptions_period_days_check', sql`${t.periodDays} in (30,60,90)`),
    check('subscriptions_payment_method_check', sql`${t.paymentMethod} in ('saved_card','pix')`),
    check('subscriptions_sale_mode_check', sql`${t.saleMode} in ('self','link','manual')`),
    check('subscriptions_source_check', sql`${t.source} in ('web','app','admin','mcp')`),
    check(
      'subscriptions_fixed_room_check',
      sql`${t.type} <> 'fixed_schedule' or ${t.roomId} is not null`,
    ),
    index('subscriptions_user_status_idx').on(t.userId, t.status),
    index('subscriptions_status_base_idx').on(t.status, t.baseOn),
    index('subscriptions_status_hold_idx').on(t.status, t.holdExpiresAt),
    // One minute balance per tenant (spec assumption "One hour package per tenant", REC-12).
    uniqueIndex('subscriptions_one_hour_pkg')
      .on(t.userId)
      .where(
        sql`${t.type} = 'hour_package' and ${t.status} in ('awaiting_payment','active','suspended')`,
      ),
  ],
);

export const PERIOD_STATUS_SQL = sql`('upcoming','awaiting_payment','paid','active','closed','failed','cancelled')`;

export const subscriptionPeriods = pgTable(
  'subscription_periods',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    subscriptionId: uuid('subscription_id')
      .notNull()
      .references(() => subscriptions.id, { onDelete: 'restrict' }),
    seq: integer('seq').notNull(),
    // [starts_on, ends_on) local dates.
    startsOn: localDate('starts_on').notNull(),
    endsOn: localDate('ends_on').notNull(),
    priceCents: integer('price_cents').notNull(),
    discountCents: integer('discount_cents').notNull().default(0),
    // Fixed schedule.
    occurrenceCount: integer('occurrence_count'),
    // Hour package; `minutes_balance` caches the sum of the period's package_ledger rows.
    includedMinutes: integer('included_minutes'),
    minutesBalance: integer('minutes_balance'),
    priceSnapshot: jsonb('price_snapshot').notNull(),
    status: text('status').notNull(),
    // Local 00:00 of starts_on − payment.subscription_renewal_days_before.
    chargeDueAt: tstz('charge_due_at').notNull(),
    renewalAttempts: smallint('renewal_attempts').notNull().default(0),
    // [{ date, reason }]: next-period dates that could not be held (REC-92).
    heldConflicts: jsonb('held_conflicts')
      .notNull()
      .default(sql`'[]'::jsonb`),
    paidAt: tstz('paid_at'),
    createdAt: tstz('created_at').notNull().defaultNow(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    check('subscription_periods_status_check', sql`${t.status} in ${PERIOD_STATUS_SQL}`),
    check(
      'subscription_periods_minutes_balance_check',
      sql`${t.minutesBalance} is null or ${t.minutesBalance} >= 0`,
    ),
    check('subscription_periods_dates_check', sql`${t.endsOn} > ${t.startsOn}`),
    unique('subscription_periods_subscription_seq_uq').on(t.subscriptionId, t.seq),
    index('subscription_periods_status_due_idx').on(t.status, t.chargeDueAt),
  ],
);

/** Append-only minute ledger of a period balance (trigger in the receita constraints migration). */
export const packageLedger = pgTable(
  'package_ledger',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    subscriptionId: uuid('subscription_id')
      .notNull()
      .references(() => subscriptions.id, { onDelete: 'restrict' }),
    periodId: uuid('period_id')
      .notNull()
      .references(() => subscriptionPeriods.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    entryType: text('entry_type').notNull(),
    // Signed.
    minutes: integer('minutes').notNull(),
    bookingId: uuid('booking_id').references(() => bookings.id, { onDelete: 'restrict' }),
    // Debit formula inputs and outputs (extrato).
    detail: jsonb('detail'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    check(
      'package_ledger_entry_type_check',
      sql`${t.entryType} in ('period_grant','debit','refund','expiry','conversion_in','conversion_out','manual_adjustment')`,
    ),
    index('package_ledger_period_idx').on(t.periodId),
    index('package_ledger_user_created_idx').on(t.userId, t.createdAt.desc()),
    index('package_ledger_subscription_created_idx').on(t.subscriptionId, t.createdAt.desc()),
  ],
);

export const extraHoursPurchases = pgTable(
  'extra_hours_purchases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    subscriptionId: uuid('subscription_id')
      .notNull()
      .references(() => subscriptions.id, { onDelete: 'restrict' }),
    hours: smallint('hours').notNull(),
    // V_pac at purchase.
    unitPriceCents: integer('unit_price_cents').notNull(),
    totalCents: integer('total_cents').notNull(),
    status: text('status').notNull(),
    holdExpiresAt: tstz('hold_expires_at'),
    createdAt: tstz('created_at').notNull().defaultNow(),
    paidAt: tstz('paid_at'),
  },
  (t) => [
    check('extra_hours_purchases_hours_check', sql`${t.hours} between 1 and 100`),
    check(
      'extra_hours_purchases_status_check',
      sql`${t.status} in ('awaiting_payment','paid','cancelled')`,
    ),
    index('extra_hours_purchases_status_hold_idx').on(t.status, t.holdExpiresAt),
  ],
);

/** One compensation per (closed day, subscription) (REC-104). */
export const closedDayCompensations = pgTable(
  'closed_day_compensations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    closedDayId: uuid('closed_day_id')
      .notNull()
      .references(() => closedDays.id, { onDelete: 'restrict' }),
    subscriptionId: uuid('subscription_id')
      .notNull()
      .references(() => subscriptions.id, { onDelete: 'restrict' }),
    periodId: uuid('period_id')
      .notNull()
      .references(() => subscriptionPeriods.id, { onDelete: 'restrict' }),
    kind: text('kind').notNull(),
    minutes: integer('minutes'),
    amountCents: integer('amount_cents'),
    extraMinuteLotId: uuid('extra_minute_lot_id').references(() => extraMinuteLots.id, {
      onDelete: 'restrict',
    }),
    creditLotId: uuid('credit_lot_id').references(() => creditLots.id, { onDelete: 'restrict' }),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    check('closed_day_compensations_kind_check', sql`${t.kind} in ('minutes','credit')`),
    unique('closed_day_compensations_day_subscription_uq').on(t.closedDayId, t.subscriptionId),
  ],
);
