import { addDays, localToUtc, utcToLocal, type LocalDate } from '@bravo/core';
import { and, eq, gte, lt, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { emailOutbox } from '../../db/schema';
import { logger } from '../../lib/logger';
import type { BucketName, Storage } from '../../lib/storage';
import { loadSettings } from '../settings/settings.repo';

// Free-tier usage panel (GES-137..GES-139): database size, the largest tables, object storage per
// bucket and e-mails sent, each against its limit in `usage.limits`; 80 % or more is a warning.

const WARNING_PERCENT = 80;
const BUCKETS: readonly BucketName[] = ['room-photos', 'expense-attachments'];

/** Share of `limit` used, 0.. with one decimal. */
const percentOf = (used: number, limit: number) => Math.round((used / limit) * 1000) / 10;

async function sentBetween(db: Db, from: Date, to: Date): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(emailOutbox)
    .where(
      and(
        eq(emailOutbox.status, 'sent'),
        gte(emailOutbox.sentAt, from),
        lt(emailOutbox.sentAt, to),
      ),
    );
  return row?.count ?? 0;
}

async function storageUsage(storage: Storage | undefined) {
  try {
    if (storage === undefined) throw new Error('object storage is not configured');
    const sizes = await Promise.all(BUCKETS.map((bucket) => storage.totalBytes(bucket)));
    return {
      buckets: { 'room-photos': sizes[0] ?? 0, 'expense-attachments': sizes[1] ?? 0 },
    };
  } catch (error) {
    logger.error('usage: object storage listing failed', {
      error: { name: (error as Error).name, message: (error as Error).message },
    });
    return { buckets: null, error: 'Não foi possível consultar o armazenamento de arquivos.' };
  }
}

/** `GET /admin/usage` (design `UsageReport`). */
export async function usageReport(deps: { db: Db; storage?: Storage | undefined }, now: Date) {
  const { db } = deps;
  const limits = (await loadSettings(db))['usage.limits'];

  const size = await db.execute<{ bytes: string }>(
    sql`select pg_database_size(current_database())::text as bytes`,
  );
  const dbBytes = Number(size.rows[0]?.bytes ?? 0);
  const tables = await db.execute<{
    name: string;
    total_bytes: string;
    estimated_rows: string;
  }>(sql`
    select c.relname as name,
           pg_total_relation_size(c.oid)::text as total_bytes,
           greatest(c.reltuples, 0)::bigint::text as estimated_rows
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
     order by pg_total_relation_size(c.oid) desc, c.relname
     limit 10`);

  const storage = await storageUsage(deps.storage);
  const storageBytes =
    storage.buckets === null
      ? null
      : storage.buckets['room-photos'] + storage.buckets['expense-attachments'];

  const today = utcToLocal(now).date;
  const monthStart = `${today.slice(0, 8)}01` as LocalDate;
  const [year, month] = today.split('-').map(Number) as [number, number];
  const nextMonth = (
    month === 12
      ? `${String(year + 1)}-01-01`
      : `${String(year)}-${String(month + 1).padStart(2, '0')}-01`
  ) as LocalDate;
  const emailsMonth = await sentBetween(db, localToUtc(monthStart, 0), localToUtc(nextMonth, 0));
  const emailsToday = await sentBetween(db, localToUtc(today, 0), localToUtc(addDays(today, 1), 0));

  const dbPercent = percentOf(dbBytes, limits.dbBytes);
  const storagePercent =
    storageBytes === null ? null : percentOf(storageBytes, limits.storageBytes);
  return {
    db: {
      bytes: dbBytes,
      limitBytes: limits.dbBytes,
      percent: dbPercent,
      warning: dbPercent >= WARNING_PERCENT,
    },
    storage: {
      buckets: storage.buckets,
      bytes: storageBytes,
      limitBytes: limits.storageBytes,
      percent: storagePercent,
      warning: storagePercent !== null && storagePercent >= WARNING_PERCENT,
      ...(storage.error !== undefined && { storageError: storage.error }),
    },
    emails: {
      month: emailsMonth,
      monthLimit: limits.emailsPerMonth,
      today: emailsToday,
      dayLimit: limits.emailsPerDay,
      warning:
        percentOf(emailsMonth, limits.emailsPerMonth) >= WARNING_PERCENT ||
        percentOf(emailsToday, limits.emailsPerDay) >= WARNING_PERCENT,
    },
    largestTables: tables.rows.map((t) => ({
      name: t.name,
      totalBytes: Number(t.total_bytes),
      estimatedRows: Number(t.estimated_rows),
    })),
  };
}
