import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { users } from './identity';
import { rooms } from './calendar';
import { bookings } from './booking';

// Management tables (docs/architecture.md section 5.5 with the refinements of gestao design.md
// "Data layer"). Every constraint is expressed here, so drizzle-kit generates the whole migration.
const tstz = (name: string) => timestamp(name, { withTimezone: true });

export const expenseCategories = pgTable(
  'expense_categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    displayOrder: integer('display_order').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: tstz('created_at').notNull().defaultNow(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('expense_categories_name_uq').on(sql`lower(${t.name})`)],
);

export const expenses = pgTable(
  'expenses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    date: date('date').notNull(),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => expenseCategories.id, { onDelete: 'restrict' }),
    description: text('description').notNull(),
    amountCents: integer('amount_cents').notNull(),
    recurrence: text('recurrence').notNull().default('none'),
    recurrenceParentId: uuid('recurrence_parent_id').references((): AnyPgColumn => expenses.id, {
      onDelete: 'restrict',
    }),
    // Object Storage key in bucket `expense-attachments`.
    attachmentKey: text('attachment_key'),
    attachmentName: text('attachment_name'),
    attachmentContentType: text('attachment_content_type'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }),
    createdAt: tstz('created_at').notNull().defaultNow(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
    deletedAt: tstz('deleted_at'),
  },
  (t) => [
    check('expenses_amount_check', sql`${t.amountCents} > 0`),
    check(
      'expenses_recurrence_check',
      sql`${t.recurrence} in ('none','monthly','quarterly','yearly')`,
    ),
    index('expenses_date_idx').on(t.date),
    // One materialized child per parent and date (GES-14).
    uniqueIndex('expenses_recurrence_child_uq')
      .on(t.recurrenceParentId, t.date)
      .where(sql`${t.recurrenceParentId} is not null and ${t.deletedAt} is null`),
    index('expenses_recurring_parent_idx')
      .on(t.recurrence)
      .where(sql`${t.recurrence} <> 'none' and ${t.deletedAt} is null`),
  ],
);

export const manualReceipts = pgTable(
  'manual_receipts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    date: date('date').notNull(),
    revenueCategory: text('revenue_category').notNull(),
    method: text('method').notNull(),
    amountCents: integer('amount_cents').notNull(),
    description: text('description'),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'restrict' }),
    bookingId: uuid('booking_id').references(() => bookings.id, { onDelete: 'restrict' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }),
    createdAt: tstz('created_at').notNull().defaultNow(),
    deletedAt: tstz('deleted_at'),
  },
  (t) => [
    check(
      'manual_receipts_revenue_category_check',
      sql`${t.revenueCategory} in ('rental_single','subscription_initial','subscription_renewal','extra_hours','extra_services','other')`,
    ),
    check('manual_receipts_method_check', sql`${t.method} in ('cash','card_machine','pix_direct')`),
    check('manual_receipts_amount_check', sql`${t.amountCents} > 0`),
    index('manual_receipts_date_idx').on(t.date),
  ],
);

export const extraServices = pgTable(
  'extra_services',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    referencePriceCents: integer('reference_price_cents'),
    unit: text('unit').notNull(),
    saleMode: text('sale_mode').notNull().default('quote'),
    status: text('status').notNull().default('active'),
    displayOrder: integer('display_order').notNull().default(0),
    createdAt: tstz('created_at').notNull().defaultNow(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    check('extra_services_unit_check', sql`${t.unit} in ('hour','project')`),
    check('extra_services_sale_mode_check', sql`${t.saleMode} in ('quote','online')`),
    check('extra_services_status_check', sql`${t.status} in ('active','inactive')`),
    check(
      'extra_services_price_check',
      sql`${t.referencePriceCents} is null or ${t.referencePriceCents} >= 0`,
    ),
  ],
);

/** Online-sold extras added at checkout; name and unit are frozen at sale time. */
export const bookingExtraItems = pgTable(
  'booking_extra_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'restrict' }),
    serviceId: uuid('service_id')
      .notNull()
      .references(() => extraServices.id, { onDelete: 'restrict' }),
    serviceName: text('service_name').notNull(),
    unit: text('unit').notNull(),
    quantity: integer('quantity').notNull(),
    unitPriceCents: integer('unit_price_cents').notNull(),
    amountCents: integer('amount_cents').notNull(),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    check('booking_extra_items_quantity_check', sql`${t.quantity} > 0`),
    check('booking_extra_items_unit_check', sql`${t.unit} in ('hour','project')`),
    index('booking_extra_items_booking_idx').on(t.bookingId),
  ],
);

export const quoteRequests = pgTable(
  'quote_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    serviceId: uuid('service_id')
      .notNull()
      .references(() => extraServices.id, { onDelete: 'restrict' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'restrict' }),
    bookingId: uuid('booking_id').references(() => bookings.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    email: text('email'),
    phone: text('phone').notNull(),
    description: text('description').notNull(),
    desiredOn: date('desired_on'),
    status: text('status').notNull().default('new'),
    source: text('source').notNull().default('web'),
    staffNotes: text('staff_notes'),
    createdAt: tstz('created_at').notNull().defaultNow(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    check(
      'quote_requests_status_check',
      sql`${t.status} in ('new','contacted','quote_sent','won','lost')`,
    ),
    check('quote_requests_source_check', sql`${t.source} in ('web','app','admin')`),
    index('quote_requests_status_created_idx').on(t.status, t.createdAt.desc()),
    index('quote_requests_user_idx').on(t.userId),
  ],
);

export const notificationRecipients = pgTable('notification_recipients', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Stored lower-cased (GES-65).
  email: text('email').notNull().unique(),
  active: boolean('active').notNull().default(true),
  createdAt: tstz('created_at').notNull().defaultNow(),
});

export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull().unique(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    userAgent: text('user_agent'),
    createdAt: tstz('created_at').notNull().defaultNow(),
    lastSuccessAt: tstz('last_success_at'),
    failureCount: integer('failure_count').notNull().default(0),
  },
  (t) => [index('push_subscriptions_user_idx').on(t.userId)],
);

export const icsFeedTokens = pgTable(
  'ics_feed_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    scope: text('scope').notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'restrict' }),
    roomId: uuid('room_id').references(() => rooms.id, { onDelete: 'restrict' }),
    tokenHash: text('token_hash').notNull().unique(),
    // First 6 chars of the raw token, for display.
    tokenPrefix: text('token_prefix').notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }),
    createdAt: tstz('created_at').notNull().defaultNow(),
    revokedAt: tstz('revoked_at'),
    lastAccessedAt: tstz('last_accessed_at'),
  },
  (t) => [
    check('ics_feed_tokens_scope_check', sql`${t.scope} in ('user','clinic','room')`),
    check('ics_feed_tokens_user_check', sql`(${t.scope} = 'user') = (${t.userId} is not null)`),
    check('ics_feed_tokens_room_check', sql`(${t.scope} = 'room') = (${t.roomId} is not null)`),
    uniqueIndex('ics_feed_tokens_user_active_uq')
      .on(t.userId)
      .where(sql`${t.scope} = 'user' and ${t.revokedAt} is null`),
    // One active clinic feed and one active feed per room (GES-42).
    uniqueIndex('ics_feed_tokens_shared_active_uq')
      .on(t.scope, sql`coalesce(${t.roomId}, '00000000-0000-0000-0000-000000000000'::uuid)`)
      .where(sql`${t.scope} in ('clinic','room') and ${t.revokedAt} is null`),
  ],
);

export const mcpTokens = pgTable(
  'mcp_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Device label.
    name: text('name').notNull(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    scope: text('scope').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    tokenPrefix: text('token_prefix').notNull(),
    createdAt: tstz('created_at').notNull().defaultNow(),
    lastUsedAt: tstz('last_used_at'),
    revokedAt: tstz('revoked_at'),
    expiresAt: tstz('expires_at'),
  },
  (t) => [
    check('mcp_tokens_scope_check', sql`${t.scope} in ('read','read_write')`),
    index('mcp_tokens_owner_active_idx')
      .on(t.ownerUserId)
      .where(sql`${t.revokedAt} is null`),
  ],
);
