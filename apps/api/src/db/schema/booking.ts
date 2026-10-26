import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './identity';
import { blocks, rooms } from './calendar';
import { charges } from './payments';
import { coupons } from './coupons';
import { subscriptionPeriods, subscriptions } from './subscriptions';

// Instants are always timestamptz (docs/architecture.md section 5.1).
const tstz = (name: string) => timestamp(name, { withTimezone: true });

export const bookingCategories = pgTable(
  'booking_categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    type: text('type').notNull(),
    weekdays: smallint('weekdays')
      .array()
      .notNull()
      .default(sql`'{1,2,3,4,5,6,7}'::smallint[]`),
    appliesOnHolidays: boolean('applies_on_holidays').notNull().default(true),
    startMinute: smallint('start_minute').notNull().default(0),
    endMinute: smallint('end_minute').notNull().default(1440),
    weekdayRateCents: integer('weekday_rate_cents'),
    weekendRateCents: integer('weekend_rate_cents'),
    minDurationMinutes: integer('min_duration_minutes'),
    fixedPriceCents: integer('fixed_price_cents'),
    pricePerOccurrenceCents: integer('price_per_occurrence_cents'),
    includedMinutes: integer('included_minutes'),
    period: text('period').notNull(),
    isReference: boolean('is_reference').notNull().default(false),
    status: text('status').notNull().default('active'),
    visibility: text('visibility').notNull().default('public'),
    roomId: uuid('room_id').references(() => rooms.id, { onDelete: 'restrict' }),
    displayOrder: integer('display_order').notNull().default(0),
    version: integer('version').notNull().default(1),
    createdAt: tstz('created_at').notNull().defaultNow(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    check(
      'booking_categories_type_check',
      sql`${t.type} in ('hourly','block','hour_package','fixed_schedule')`,
    ),
    check(
      'booking_categories_period_check',
      sql`${t.period} in ('single','monthly','bimonthly','quarterly')`,
    ),
    check('booking_categories_status_check', sql`${t.status} in ('active','inactive')`),
    check('booking_categories_visibility_check', sql`${t.visibility} in ('public','admin_only')`),
    check(
      'booking_categories_hourly_check',
      sql`${t.type} <> 'hourly' or (${t.weekdayRateCents} is not null and ${t.weekendRateCents} is not null and ${t.minDurationMinutes} is not null and ${t.period} = 'single')`,
    ),
    check(
      'booking_categories_block_check',
      sql`${t.type} <> 'block' or (${t.fixedPriceCents} is not null and ${t.period} = 'single')`,
    ),
    check(
      'booking_categories_hour_package_check',
      sql`${t.type} <> 'hour_package' or (${t.fixedPriceCents} is not null and ${t.includedMinutes} > 0 and ${t.period} <> 'single')`,
    ),
    check(
      'booking_categories_fixed_schedule_check',
      sql`${t.type} <> 'fixed_schedule' or (${t.pricePerOccurrenceCents} is not null and ${t.period} <> 'single')`,
    ),
    check(
      'booking_categories_reference_hourly_check',
      sql`not ${t.isReference} or ${t.type} = 'hourly'`,
    ),
    uniqueIndex('booking_categories_reference_uq')
      .on(t.isReference)
      .where(sql`${t.isReference}`),
  ],
);

export const BOOKING_STATUS_SQL = sql`('awaiting_payment','pre_reserved','held_for_renewal','confirmed','paid','completed','no_show','expired','cancelled_by_tenant','cancelled_nonpayment','cancelled_by_clinic')`;

export const bookings = pgTable(
  'bookings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull().unique(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'restrict' }),
    kind: text('kind').notNull().default('single'),
    status: text('status').notNull(),
    source: text('source').notNull(),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'restrict',
    }),
    startsAt: tstz('starts_at').notNull(),
    endsAt: tstz('ends_at').notNull(),
    cleanupMinutes: integer('cleanup_minutes').notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
    paymentMode: text('payment_mode').notNull(),
    grossCents: integer('gross_cents').notNull().default(0),
    discountCents: integer('discount_cents').notNull().default(0),
    discountSource: text('discount_source').notNull().default('none'),
    totalCents: integer('total_cents').notNull().default(0),
    depositCents: integer('deposit_cents').notNull().default(0),
    balanceCents: integer('balance_cents').notNull().default(0),
    paidCents: integer('paid_cents').notNull().default(0),
    creditAppliedCents: integer('credit_applied_cents').notNull().default(0),
    balanceChargeAt: tstz('balance_charge_at'),
    balanceDueAt: tstz('balance_due_at'),
    holdExpiresAt: tstz('hold_expires_at'),
    policySnapshot: jsonb('policy_snapshot').notNull(),
    rescheduleCount: integer('reschedule_count').notNull().default(0),
    checkedInAt: tstz('checked_in_at'),
    cancelledAt: tstz('cancelled_at'),
    cancelReason: text('cancel_reason'),
    cancelledBy: uuid('cancelled_by').references(() => users.id, { onDelete: 'restrict' }),
    confirmedManuallyBy: uuid('confirmed_manually_by').references(() => users.id, {
      onDelete: 'restrict',
    }),
    icsUid: text('ics_uid').notNull().unique(),
    icsSequence: integer('ics_sequence').notNull().default(0),
    notes: text('notes'),
    // sha256 of the payment-link token (pre-reservations and staff bookings); rotated by resend.
    paymentLinkTokenHash: text('payment_link_token_hash'),
    // Set by the cleanup exception (NUC-39); such bookings are excluded from global cleanup changes.
    cleanupOverriddenBy: uuid('cleanup_overridden_by').references(() => users.id, {
      onDelete: 'restrict',
    }),
    cleanupOverriddenAt: tstz('cleanup_overridden_at'),
    // Receita (docs/architecture.md section 5.4 ALTERs).
    couponId: uuid('coupon_id').references(() => coupons.id, { onDelete: 'restrict' }),
    subscriptionId: uuid('subscription_id').references(() => subscriptions.id, {
      onDelete: 'restrict',
    }),
    subscriptionPeriodId: uuid('subscription_period_id').references(() => subscriptionPeriods.id, {
      onDelete: 'restrict',
    }),
    packageMinutesDebited: integer('package_minutes_debited').notNull().default(0),
    extraMinutesDebited: integer('extra_minutes_debited').notNull().default(0),
    createdAt: tstz('created_at').notNull().defaultNow(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    check('bookings_kind_check', sql`${t.kind} in ('single','fixed_occurrence')`),
    check('bookings_status_check', sql`${t.status} in ${BOOKING_STATUS_SQL}`),
    check('bookings_source_check', sql`${t.source} in ('web','app','admin','mcp')`),
    check(
      'bookings_payment_mode_check',
      sql`${t.paymentMode} in ('deposit_balance','full_upfront','package','subscription','manual')`,
    ),
    check(
      'bookings_discount_source_check',
      sql`${t.discountSource} in ('none','coupon','slot_discount')`,
    ),
    check('bookings_period_check', sql`${t.endsAt} > ${t.startsAt}`),
    index('bookings_user_starts_idx').on(t.userId, t.startsAt.desc()),
    index('bookings_room_starts_idx').on(t.roomId, t.startsAt),
    index('bookings_status_hold_idx').on(t.status, t.holdExpiresAt),
    index('bookings_status_balance_charge_idx').on(t.status, t.balanceChargeAt),
    // The 3-hold rule (NUC-96) counts a user's awaiting_payment bookings.
    index('bookings_user_awaiting_idx')
      .on(t.userId, t.status)
      .where(sql`${t.status} = 'awaiting_payment'`),
    index('bookings_subscription_idx')
      .on(t.subscriptionId, t.startsAt)
      .where(sql`${t.subscriptionId} is not null`),
    uniqueIndex('bookings_payment_link_uq')
      .on(t.paymentLinkTokenHash)
      .where(sql`${t.paymentLinkTokenHash} is not null`),
  ],
);

export const bookingSegments = pgTable(
  'booking_segments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'cascade' }),
    seq: smallint('seq').notNull(),
    startsAt: tstz('starts_at').notNull(),
    endsAt: tstz('ends_at').notNull(),
    categoryId: uuid('category_id').references(() => bookingCategories.id, {
      onDelete: 'restrict',
    }),
    categoryName: text('category_name').notNull(),
    dayType: text('day_type').notNull(),
    rateCentsPerHour: integer('rate_cents_per_hour'),
    minutes: integer('minutes').notNull(),
    amountCents: integer('amount_cents').notNull(),
  },
  (t) => [
    check('booking_segments_day_type_check', sql`${t.dayType} in ('weekday','weekend_holiday')`),
    unique('booking_segments_booking_seq_uq').on(t.bookingId, t.seq),
  ],
);

/** Append-only status history (trigger forbid_update_delete in the nucleo constraints migration). */
export const bookingEvents = pgTable(
  'booking_events',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'restrict' }),
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    at: tstz('at').notNull().defaultNow(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'restrict' }),
    origin: text('origin').notNull(),
    reason: text('reason'),
    data: jsonb('data'),
  },
  (t) => [
    check(
      'booking_events_origin_check',
      sql`${t.origin} in ('web','app','admin','mcp','job','system')`,
    ),
    index('booking_events_booking_idx').on(t.bookingId, t.at),
  ],
);

/** A reschedule to a more expensive slot, held by a system block until the difference is paid. */
export const bookingRescheduleRequests = pgTable(
  'booking_reschedule_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    newRoomId: uuid('new_room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'restrict' }),
    newStartsAt: tstz('new_starts_at').notNull(),
    newEndsAt: tstz('new_ends_at').notNull(),
    // Frozen quote of the new slot: segments, gross and net.
    quote: jsonb('quote').notNull(),
    payNowCents: integer('pay_now_cents').notNull(),
    chargeId: uuid('charge_id').references(() => charges.id, { onDelete: 'restrict' }),
    holdBlockId: uuid('hold_block_id').references(() => blocks.id, { onDelete: 'restrict' }),
    status: text('status').notNull().default('pending'),
    expiresAt: tstz('expires_at').notNull(),
    createdAt: tstz('created_at').notNull().defaultNow(),
    appliedAt: tstz('applied_at'),
  },
  (t) => [
    check('booking_reschedule_requests_pay_now_check', sql`${t.payNowCents} > 0`),
    check(
      'booking_reschedule_requests_status_check',
      sql`${t.status} in ('pending','applied','expired','cancelled','refunded')`,
    ),
    uniqueIndex('booking_reschedule_requests_pending_uq')
      .on(t.bookingId)
      .where(sql`${t.status} = 'pending'`),
  ],
);

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    key: text('key').notNull(),
    route: text('route').notNull(),
    requestHash: text('request_hash').notNull(),
    responseStatus: integer('response_status'),
    responseBody: jsonb('response_body'),
    createdAt: tstz('created_at').notNull().defaultNow(),
    expiresAt: tstz('expires_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.key] }),
    index('idempotency_keys_expires_idx').on(t.expiresAt),
  ],
);
