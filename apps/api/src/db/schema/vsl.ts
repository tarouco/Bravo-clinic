import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  inet,
  integer,
  numeric,
  pgSequence,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

const tstz = (name: string) => timestamp(name, { withTimezone: true });

/**
 * Turn counter of the Home intro video: each first-time visitor takes the next value and plays
 * video `turn % videos.length`, so consecutive visitors alternate.
 */
export const vslRotationSeq = pgSequence('vsl_rotation_seq', { startWith: 0, minValue: 0 });

/**
 * One row per closed Home intro video (VSL), for retention analysis. Read only by the database
 * admin: no API route lists it. `accessed_at` is when the video opened, `closed_at` when the
 * visitor left it, `played_seconds` the playback position at that moment.
 */
export const logsDeVsl = pgTable(
  'Logs_de_VSL',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    ip: inet('ip'),
    accessedAt: tstz('accessed_at').notNull(),
    closedAt: tstz('closed_at').notNull().defaultNow(),
    videoName: text('video_name').notNull(),
    playedSeconds: numeric('played_seconds', { precision: 8, scale: 3 }).notNull(),
    durationSeconds: numeric('duration_seconds', { precision: 8, scale: 3 }),
    turn: integer('turn'),
    exitMethod: text('exit_method').notNull(),
    device: text('device').notNull(),
    userAgent: text('user_agent'),
  },
  (t) => [
    check('logs_de_vsl_exit_check', sql`${t.exitMethod} in ('click','escape','pagehide')`),
    check('logs_de_vsl_device_check', sql`${t.device} in ('mobile','desktop')`),
    check('logs_de_vsl_played_check', sql`${t.playedSeconds} >= 0`),
    index('logs_de_vsl_accessed_at_idx').on(t.accessedAt.desc()),
    index('logs_de_vsl_video_idx').on(t.videoName, t.accessedAt.desc()),
  ],
);
