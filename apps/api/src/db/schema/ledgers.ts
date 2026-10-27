import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './identity';
import { bookings } from './booking';
import { charges } from './payments';
import { extraHoursPurchases } from './subscriptions';

// Extra-minute lots and customer credits (docs/architecture.md section 5.4). Balances are cached in
// `minutes_remaining` / `remaining_cents` and updated in the same transaction as the ledger insert.
const tstz = (name: string) => timestamp(name, { withTimezone: true });

/** Extra hours and closed-day compensation (both shown as "horas extras"). */
export const extraMinuteLots = pgTable(
  'extra_minute_lots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    source: text('source').notNull(),
    purchaseId: uuid('purchase_id').references(() => extraHoursPurchases.id, {
      onDelete: 'restrict',
    }),
    minutesGranted: integer('minutes_granted').notNull(),
    minutesRemaining: integer('minutes_remaining').notNull(),
    expiresAt: tstz('expires_at').notNull(),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    check(
      'extra_minute_lots_source_check',
      sql`${t.source} in ('purchase','closed_day_compensation','manual')`,
    ),
    check('extra_minute_lots_granted_check', sql`${t.minutesGranted} > 0`),
    check('extra_minute_lots_remaining_check', sql`${t.minutesRemaining} >= 0`),
    index('extra_minute_lots_user_expires_idx')
      .on(t.userId, t.expiresAt)
      .where(sql`${t.minutesRemaining} > 0`),
  ],
);

/** Append-only (trigger in the receita constraints migration). */
export const extraMinutesLedger = pgTable(
  'extra_minutes_ledger',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    lotId: uuid('lot_id')
      .notNull()
      .references(() => extraMinuteLots.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    entryType: text('entry_type').notNull(),
    // Signed.
    minutes: integer('minutes').notNull(),
    bookingId: uuid('booking_id').references(() => bookings.id, { onDelete: 'restrict' }),
    detail: jsonb('detail'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    check(
      'extra_minutes_ledger_entry_type_check',
      sql`${t.entryType} in ('grant','debit','refund','expiry','manual_adjustment')`,
    ),
    index('extra_minutes_ledger_lot_idx').on(t.lotId),
    index('extra_minutes_ledger_user_created_idx').on(t.userId, t.createdAt.desc()),
  ],
);

export const creditLots = pgTable(
  'credit_lots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    source: text('source').notNull(),
    amountCents: integer('amount_cents').notNull(),
    remainingCents: integer('remaining_cents').notNull(),
    expiresAt: tstz('expires_at').notNull(),
    refType: text('ref_type'),
    refId: uuid('ref_id'),
    justification: text('justification'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    check(
      'credit_lots_source_check',
      sql`${t.source} in ('reschedule_difference','closed_day_compensation','manual','clinic_cancellation')`,
    ),
    check('credit_lots_amount_check', sql`${t.amountCents} > 0`),
    check('credit_lots_remaining_check', sql`${t.remainingCents} >= 0`),
    index('credit_lots_user_expires_idx')
      .on(t.userId, t.expiresAt)
      .where(sql`${t.remainingCents} > 0`),
  ],
);

/** Append-only (trigger in the receita constraints migration). */
export const creditLedger = pgTable(
  'credit_ledger',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    lotId: uuid('lot_id')
      .notNull()
      .references(() => creditLots.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    entryType: text('entry_type').notNull(),
    // Signed.
    amountCents: integer('amount_cents').notNull(),
    bookingId: uuid('booking_id').references(() => bookings.id, { onDelete: 'restrict' }),
    chargeId: uuid('charge_id').references(() => charges.id, { onDelete: 'restrict' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    check(
      'credit_ledger_entry_type_check',
      sql`${t.entryType} in ('grant','use','refund','expiry','manual_adjustment')`,
    ),
    index('credit_ledger_lot_idx').on(t.lotId),
    index('credit_ledger_user_created_idx').on(t.userId, t.createdAt.desc()),
    index('credit_ledger_charge_idx').on(t.chargeId),
  ],
);
