import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
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
} from 'drizzle-orm/pg-core';
import { users } from './identity';

// Instants are always timestamptz, local calendar dates are `date` (docs/architecture.md section 5.1).
const tstz = (name: string) => timestamp(name, { withTimezone: true });
const localDate = (name: string) => date(name, { mode: 'string' });

/** Postgres `tstzrange`, exchanged in its text form, e.g. `[2026-01-01 10:00+00,2026-01-01 11:00+00)`. */
const tstzrange = customType<{ data: string }>({
  dataType: () => 'tstzrange',
});

export const rooms = pgTable(
  'rooms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    idealFor: text('ideal_for')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    equipment: text('equipment')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    status: text('status').notNull().default('active'),
    displayOrder: integer('display_order').notNull().default(0),
    createdAt: tstz('created_at').notNull().defaultNow(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [check('rooms_status_check', sql`${t.status} in ('active','inactive')`)],
);

export const roomPhotos = pgTable(
  'room_photos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    storageKey: text('storage_key').notNull(),
    alt: text('alt').notNull().default(''),
    width: integer('width'),
    height: integer('height'),
    isCover: boolean('is_cover').notNull().default(false),
    displayOrder: integer('display_order').notNull().default(0),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('room_photos_cover_uq')
      .on(t.roomId)
      .where(sql`${t.isCover}`),
  ],
);

export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: tstz('updated_at').notNull().defaultNow(),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'restrict' }),
});

export const businessHours = pgTable(
  'business_hours',
  {
    dayType: text('day_type').primaryKey(),
    isClosed: boolean('is_closed').notNull().default(false),
    openMinute: smallint('open_minute').notNull(),
    closeMinute: smallint('close_minute').notNull(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'restrict' }),
  },
  (t) => [
    check(
      'business_hours_day_type_check',
      sql`${t.dayType} in ('mon','tue','wed','thu','fri','sat','sun','holiday')`,
    ),
    check(
      'business_hours_range_check',
      sql`${t.closeMinute} > ${t.openMinute} and ${t.openMinute} >= 0 and ${t.closeMinute} <= 1440`,
    ),
  ],
);

export const holidays = pgTable(
  'holidays',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    date: localDate('date').notNull(),
    name: text('name').notNull(),
    scope: text('scope').notNull(),
    source: text('source').notNull(),
    isClosed: boolean('is_closed').notNull().default(false),
    needsReview: boolean('needs_review').notNull().default(false),
    createdAt: tstz('created_at').notNull().defaultNow(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    check('holidays_scope_check', sql`${t.scope} in ('national','state','municipal','optional')`),
    check('holidays_source_check', sql`${t.source} in ('seed','brasilapi','manual')`),
    unique('holidays_date_name_uq').on(t.date, t.name),
    index('holidays_date_idx').on(t.date),
  ],
);

// The unique index closed_days_uq on (date, coalesce(room_id, zero uuid)) is an expression index
// that Drizzle cannot express; it lives in drizzle/0001_base_constraints.sql (T21).
export const closedDays = pgTable('closed_days', {
  id: uuid('id').primaryKey().defaultRandom(),
  date: localDate('date').notNull(),
  roomId: uuid('room_id').references(() => rooms.id, { onDelete: 'restrict' }),
  reason: text('reason'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }),
  createdAt: tstz('created_at').notNull().defaultNow(),
});

export const blockRecurrences = pgTable(
  'block_recurrences',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'restrict' }),
    tag: text('tag').notNull(),
    weekdays: smallint('weekdays').array().notNull(),
    startMinute: smallint('start_minute').notNull(),
    endMinute: smallint('end_minute').notNull(),
    validFrom: localDate('valid_from').notNull(),
    validUntil: localDate('valid_until'),
    active: boolean('active').notNull().default(true),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }),
    createdAt: tstz('created_at').notNull().defaultNow(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [check('block_recurrences_minutes_check', sql`${t.endMinute} > ${t.startMinute}`)],
);

export const blocks = pgTable(
  'blocks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'restrict' }),
    tag: text('tag').notNull(),
    startsAt: tstz('starts_at').notNull(),
    endsAt: tstz('ends_at').notNull(),
    recurrenceId: uuid('recurrence_id').references(() => blockRecurrences.id, {
      onDelete: 'restrict',
    }),
    cancelledAt: tstz('cancelled_at'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    check('blocks_period_check', sql`${t.endsAt} > ${t.startsAt}`),
    index('blocks_room_starts_idx').on(t.roomId, t.startsAt),
    unique('blocks_recurrence_starts_uq').on(t.recurrenceId, t.startsAt),
  ],
);

// The double-booking guard (AD-004). The exclusion constraint room_occupancy_no_overlap, the period
// shape check and the gist index on period are hand-written in drizzle/0001_base_constraints.sql (T21).
export const roomOccupancy = pgTable(
  'room_occupancy',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'restrict' }),
    period: tstzrange('period').notNull(),
    kind: text('kind').notNull(),
    refId: uuid('ref_id').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: tstz('created_at').notNull().defaultNow(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    check('room_occupancy_kind_check', sql`${t.kind} in ('booking','block')`),
    uniqueIndex('room_occupancy_kind_ref_uq')
      .on(t.kind, t.refId)
      .where(sql`${t.active}`),
  ],
);
