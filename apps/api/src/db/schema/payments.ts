import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
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
import { bookings } from './booking';

// Instants are always timestamptz (docs/architecture.md section 5.1).
const tstz = (name: string) => timestamp(name, { withTimezone: true });

export const paymentCustomers = pgTable(
  'payment_customers',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    provider: text('provider').notNull(),
    externalCustomerId: text('external_customer_id').notNull(),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.provider] })],
);

export const savedCards = pgTable(
  'saved_cards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    provider: text('provider').notNull(),
    externalCardId: text('external_card_id').notNull(),
    brand: text('brand'),
    last4: char('last4', { length: 4 }),
    expMonth: smallint('exp_month'),
    expYear: smallint('exp_year'),
    // Explicit consent for recurring charges (docs/architecture.md section 8).
    recurringConsentAt: tstz('recurring_consent_at'),
    createdAt: tstz('created_at').notNull().defaultNow(),
    deletedAt: tstz('deleted_at'),
  },
  (t) => [unique('saved_cards_provider_card_uq').on(t.provider, t.externalCardId)],
);

export const charges = pgTable(
  'charges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: text('provider').notNull(),
    externalId: text('external_id'),
    purpose: text('purpose').notNull(),
    method: text('method').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    bookingId: uuid('booking_id').references(() => bookings.id, { onDelete: 'restrict' }),
    amountCents: integer('amount_cents').notNull(),
    feeCents: integer('fee_cents').notNull().default(0),
    status: text('status').notNull(),
    pixQrCode: text('pix_qr_code'),
    pixCopyPaste: text('pix_copy_paste'),
    checkoutUrl: text('checkout_url'),
    expiresAt: tstz('expires_at'),
    approvedAt: tstz('approved_at'),
    refundedCents: integer('refunded_cents').notNull().default(0),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    rawLast: jsonb('raw_last'),
    createdAt: tstz('created_at').notNull().defaultNow(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    check('charges_amount_check', sql`${t.amountCents} > 0`),
    check(
      'charges_purpose_check',
      sql`${t.purpose} in ('booking_deposit','booking_balance','booking_full','booking_difference','subscription_initial','subscription_renewal','extra_hours','extra_service')`,
    ),
    check('charges_method_check', sql`${t.method} in ('pix','card','saved_card','credit')`),
    check(
      'charges_status_check',
      sql`${t.status} in ('pending','approved','rejected','cancelled','expired','refunded','partially_refunded','charged_back')`,
    ),
    uniqueIndex('charges_provider_external_uq')
      .on(t.provider, t.externalId)
      .where(sql`${t.externalId} is not null`),
    index('charges_status_created_idx').on(t.status, t.createdAt),
    index('charges_booking_idx').on(t.bookingId),
  ],
);

export const refunds = pgTable(
  'refunds',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    chargeId: uuid('charge_id')
      .notNull()
      .references(() => charges.id, { onDelete: 'restrict' }),
    bookingId: uuid('booking_id').references(() => bookings.id, { onDelete: 'restrict' }),
    provider: text('provider').notNull(),
    externalId: text('external_id'),
    amountCents: integer('amount_cents').notNull(),
    // 'tenant_cancel' | 'clinic_cancel' | 'late_approval_conflict' | 'manual'
    reason: text('reason').notNull(),
    status: text('status').notNull(),
    attempts: integer('attempts').notNull().default(0),
    // At most 500 characters, never headers.
    lastError: text('last_error'),
    requestedBy: uuid('requested_by').references(() => users.id, { onDelete: 'restrict' }),
    createdAt: tstz('created_at').notNull().defaultNow(),
    completedAt: tstz('completed_at'),
  },
  (t) => [
    check('refunds_amount_check', sql`${t.amountCents} > 0`),
    check('refunds_status_check', sql`${t.status} in ('pending','approved','failed')`),
    index('refunds_charge_idx').on(t.chargeId),
  ],
);

export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: text('provider').notNull(),
    externalId: text('external_id').notNull(),
    externalStatus: text('external_status').notNull(),
    signatureValid: boolean('signature_valid').notNull(),
    payload: jsonb('payload').notNull(),
    receivedAt: tstz('received_at').notNull().defaultNow(),
    processedAt: tstz('processed_at'),
    error: text('error'),
  },
  // AD-006 idempotency.
  (t) => [
    unique('webhook_events_provider_external_status_uq').on(
      t.provider,
      t.externalId,
      t.externalStatus,
    ),
  ],
);

export const jobRuns = pgTable(
  'job_runs',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    job: text('job').notNull(),
    invocationId: text('invocation_id'),
    startedAt: tstz('started_at').notNull().defaultNow(),
    finishedAt: tstz('finished_at'),
    status: text('status').notNull(),
    stats: jsonb('stats'),
    error: text('error'),
  },
  (t) => [
    check('job_runs_status_check', sql`${t.status} in ('running','ok','error')`),
    index('job_runs_job_started_idx').on(t.job, t.startedAt.desc()),
  ],
);
