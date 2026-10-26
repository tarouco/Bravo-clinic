import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './identity';
import { rooms } from './calendar';
import { bookings } from './booking';
import { subscriptions } from './subscriptions';

// Coupons and slot discounts (docs/architecture.md section 5.4). The coupon-use transition trigger
// and the slot-discount exclusion constraint live in the receita constraints migration.
const tstz = (name: string) => timestamp(name, { withTimezone: true });

/** Postgres `tstzrange`, exchanged in its text form, e.g. `[2026-01-01 10:00+00,2026-01-01 11:00+00)`. */
const tstzrange = customType<{ data: string }>({
  dataType: () => 'tstzrange',
});

export const coupons = pgTable(
  'coupons',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Stored upper-case.
    code: text('code').notNull(),
    type: text('type').notNull(),
    discountKind: text('discount_kind').notNull(),
    // Percent: basis points (1000 = 10%); fixed: cents.
    discountValue: integer('discount_value').notNull(),
    appliesTo: text('applies_to').notNull(),
    // null = unlimited.
    maxUses: integer('max_uses'),
    usesCount: integer('uses_count').notNull().default(0),
    perCustomerLimit: integer('per_customer_limit'),
    validFrom: tstz('valid_from'),
    validUntil: tstz('valid_until'),
    enabled: boolean('enabled').notNull().default(true),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }),
    createdAt: tstz('created_at').notNull().defaultNow(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    check('coupons_type_check', sql`${t.type} in ('first_booking','discount')`),
    check('coupons_discount_kind_check', sql`${t.discountKind} in ('percent','fixed')`),
    check('coupons_discount_value_check', sql`${t.discountValue} > 0`),
    check('coupons_applies_to_check', sql`${t.appliesTo} in ('bookings','packages','both')`),
    check(
      'coupons_first_booking_check',
      sql`${t.type} <> 'first_booking' or ${t.appliesTo} = 'bookings'`,
    ),
    check('coupons_uses_count_check', sql`${t.usesCount} >= 0`),
    check('coupons_max_uses_check', sql`${t.maxUses} is null or ${t.usesCount} <= ${t.maxUses}`),
    uniqueIndex('coupons_code_uq').on(t.code),
  ],
);

export const couponUses = pgTable(
  'coupon_uses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    couponId: uuid('coupon_id')
      .notNull()
      .references(() => coupons.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    // First-booking eligibility and per-customer limit by CPF/CNPJ (REC-118, REC-119).
    docNumber: text('doc_number'),
    bookingId: uuid('booking_id').references(() => bookings.id, { onDelete: 'restrict' }),
    subscriptionId: uuid('subscription_id').references(() => subscriptions.id, {
      onDelete: 'restrict',
    }),
    discountCents: integer('discount_cents').notNull(),
    // reserved during the checkout hold.
    status: text('status').notNull(),
    createdAt: tstz('created_at').notNull().defaultNow(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    check('coupon_uses_status_check', sql`${t.status} in ('reserved','consumed','released')`),
    check('coupon_uses_discount_check', sql`${t.discountCents} >= 0`),
    index('coupon_uses_coupon_idx').on(t.couponId),
    index('coupon_uses_doc_idx').on(t.docNumber),
    index('coupon_uses_user_idx').on(t.userId),
    uniqueIndex('coupon_uses_coupon_booking_uq')
      .on(t.couponId, t.bookingId)
      .where(sql`${t.bookingId} is not null`),
    uniqueIndex('coupon_uses_coupon_subscription_uq')
      .on(t.couponId, t.subscriptionId)
      .where(sql`${t.subscriptionId} is not null`),
  ],
);

export const slotDiscounts = pgTable(
  'slot_discounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'restrict' }),
    period: tstzrange('period').notNull(),
    percent: smallint('percent').notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }),
    createdAt: tstz('created_at').notNull().defaultNow(),
    removedAt: tstz('removed_at'),
    consumedByBookingId: uuid('consumed_by_booking_id').references(() => bookings.id, {
      onDelete: 'restrict',
    }),
  },
  (t) => [
    check('slot_discounts_percent_check', sql`${t.percent} between 1 and 100`),
    index('slot_discounts_room_idx').on(t.roomId),
  ],
);
