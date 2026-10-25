import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  inet,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// Instants are always timestamptz (docs/architecture.md section 5.1).
const tstz = (name: string) => timestamp(name, { withTimezone: true });

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    role: text('role').notNull().default('tenant'),
    status: text('status').notNull().default('active'),
    name: text('name').notNull(),
    email: text('email').notNull(),
    emailVerifiedAt: tstz('email_verified_at'),
    passwordHash: text('password_hash'),
    googleSub: text('google_sub'),
    docType: text('doc_type'),
    docNumber: text('doc_number'),
    phone: text('phone'),
    profession: text('profession'),
    professionalRegistry: text('professional_registry'),
    notes: text('notes'),
    lastLoginAt: tstz('last_login_at'),
    deletedAt: tstz('deleted_at'),
    createdAt: tstz('created_at').notNull().defaultNow(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    check('users_role_check', sql`${t.role} in ('tenant','reception','admin')`),
    check('users_status_check', sql`${t.status} in ('active','disabled','deleted')`),
    check('users_doc_type_check', sql`${t.docType} in ('cpf','cnpj')`),
    check('users_doc_pair_check', sql`(${t.docType} is null) = (${t.docNumber} is null)`),
    uniqueIndex('users_email_uq').on(t.email),
    uniqueIndex('users_google_sub_uq')
      .on(t.googleSub)
      .where(sql`${t.googleSub} is not null`),
    uniqueIndex('users_doc_uq')
      .on(t.docNumber)
      .where(sql`${t.docNumber} is not null`),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    mfaVerifiedAt: tstz('mfa_verified_at'),
    expiresAt: tstz('expires_at').notNull(),
    revokedAt: tstz('revoked_at'),
    ip: inet('ip'),
    userAgent: text('user_agent'),
    createdAt: tstz('created_at').notNull().defaultNow(),
    lastSeenAt: tstz('last_seen_at').notNull().defaultNow(),
  },
  (t) => [index('sessions_user_active_idx').on(t.userId).where(sql`${t.revokedAt} is null`)],
);

/** E-mail verification and password reset tokens; only the sha256 of the token is stored. */
export const authTokens = pgTable(
  'auth_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: text('purpose').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: tstz('expires_at').notNull(),
    usedAt: tstz('used_at'),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    check('auth_tokens_purpose_check', sql`${t.purpose} in ('email_verify','password_reset')`),
    uniqueIndex('auth_tokens_token_hash_uq').on(t.tokenHash),
    index('auth_tokens_user_purpose_idx').on(t.userId, t.purpose, t.createdAt),
  ],
);

export const userTotp = pgTable('user_totp', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  secretCiphertext: text('secret_ciphertext').notNull(),
  confirmedAt: tstz('confirmed_at'),
  lastUsedStep: bigint('last_used_step', { mode: 'number' }),
  recoveryCodeHashes: text('recovery_code_hashes')
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  createdAt: tstz('created_at').notNull().defaultNow(),
  updatedAt: tstz('updated_at').notNull().defaultNow(),
});

/** Append-only (trigger forbid_update_delete in the custom migration). */
export const consents = pgTable(
  'consents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'restrict' }),
    kind: text('kind').notNull(),
    version: text('version').notNull(),
    acceptedAt: tstz('accepted_at').notNull().defaultNow(),
    ip: inet('ip'),
    userAgent: text('user_agent'),
    refType: text('ref_type'),
    refId: uuid('ref_id'),
  },
  (t) => [
    check(
      'consents_kind_check',
      sql`${t.kind} in ('terms','privacy','booking_policy','subscription_terms','recurring_charge')`,
    ),
    index('consents_user_kind_idx').on(t.userId, t.kind),
  ],
);

/** Fixed-window counters for auth and MCP rate limits. */
export const rateLimitBuckets = pgTable(
  'rate_limit_buckets',
  {
    key: text('key').notNull(),
    windowStart: tstz('window_start').notNull(),
    count: integer('count').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
);
