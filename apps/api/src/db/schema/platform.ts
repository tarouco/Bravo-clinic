import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  inet,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './identity';

// Instants are always timestamptz (docs/architecture.md section 5.1).
const tstz = (name: string) => timestamp(name, { withTimezone: true });

/** Append-only (trigger forbid_update_delete in drizzle/0001_base_constraints.sql). */
export const auditLog = pgTable(
  'audit_log',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    at: tstz('at').notNull().defaultNow(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'restrict' }),
    actorRole: text('actor_role'),
    origin: text('origin').notNull(),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    justification: text('justification'),
    before: jsonb('before'),
    after: jsonb('after'),
    ip: inet('ip'),
    requestId: text('request_id'),
  },
  (t) => [
    check('audit_log_origin_check', sql`${t.origin} in ('web','app','admin','mcp','job','system')`),
    index('audit_log_entity_idx').on(t.entityType, t.entityId),
    index('audit_log_at_idx').on(t.at.desc()),
    index('audit_log_actor_at_idx').on(t.actorUserId, t.at.desc()),
  ],
);

export const emailOutbox = pgTable(
  'email_outbox',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    toAddress: text('to_address').notNull(),
    template: text('template').notNull(),
    subject: text('subject').notNull(),
    html: text('html').notNull(),
    textBody: text('text_body').notNull(),
    attachments: jsonb('attachments')
      .notNull()
      .default(sql`'[]'::jsonb`),
    status: text('status').notNull().default('pending'),
    providerMessageId: text('provider_message_id'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    dedupeKey: text('dedupe_key'),
    createdAt: tstz('created_at').notNull().defaultNow(),
    sentAt: tstz('sent_at'),
  },
  (t) => [
    check('email_outbox_status_check', sql`${t.status} in ('pending','sent','failed','not_sent')`),
    uniqueIndex('email_outbox_dedupe_key_uq')
      .on(t.dedupeKey)
      .where(sql`${t.dedupeKey} is not null`),
    index('email_outbox_status_created_idx').on(t.status, t.createdAt),
  ],
);

export const integrationSettings = pgTable(
  'integration_settings',
  {
    key: text('key').primaryKey(),
    enabled: boolean('enabled').notNull().default(false),
    environment: text('environment'),
    config: jsonb('config')
      .notNull()
      .default(sql`'{}'::jsonb`),
    secretCiphertext: text('secret_ciphertext'),
    secretHint: text('secret_hint'),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'restrict' }),
  },
  (t) => [
    check('integration_settings_environment_check', sql`${t.environment} in ('test','production')`),
  ],
);
