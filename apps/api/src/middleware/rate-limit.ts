import { and, eq, sql } from 'drizzle-orm';
import type { Db, Tx } from '../db/client';
import { rateLimitBuckets } from '../db/schema';
import { sha256Hex } from '../lib/crypto';

export interface RateLimitOptions {
  limit: number;
  windowSeconds: number;
  /** Injectable clock for tests; defaults to the current time. */
  now?: Date;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the current fixed window ends (always > 0). */
  retryAfterSeconds: number;
}

/** Fixed window aligned to the epoch: its start instant and the seconds left until it ends. */
function windowOf(opts: RateLimitOptions) {
  const nowMs = (opts.now ?? new Date()).getTime();
  const windowMs = opts.windowSeconds * 1000;
  const startMs = Math.floor(nowMs / windowMs) * windowMs;
  return {
    start: new Date(startMs),
    retryAfterSeconds: Math.max(1, Math.ceil((startMs + windowMs - nowMs) / 1000)),
  };
}

/** Key for a bucket: the raw identifier (e-mail, IP, user id) is hashed and never stored. */
export function rateLimitKey(kind: string, raw: string): string {
  return `${kind}:${sha256Hex(raw)}`;
}

/**
 * Counts one hit in the current window and says whether it is within the limit. Pass the pool-level
 * `db`, not a request transaction, so a failed attempt still counts after the request rolls back.
 */
export async function consumeRateLimit(
  db: Db | Tx,
  key: string,
  opts: RateLimitOptions,
): Promise<RateLimitResult> {
  const { start, retryAfterSeconds } = windowOf(opts);
  const [row] = await db
    .insert(rateLimitBuckets)
    .values({ key, windowStart: start, count: 1 })
    .onConflictDoUpdate({
      target: [rateLimitBuckets.key, rateLimitBuckets.windowStart],
      set: { count: sql`${rateLimitBuckets.count} + 1` },
    })
    .returning({ count: rateLimitBuckets.count });
  if (row === undefined) throw new Error('consumeRateLimit: upsert returned no row');
  return { allowed: row.count <= opts.limit, retryAfterSeconds };
}

/** Reads the current window without counting: not allowed once `limit` hits were recorded. */
export async function peekRateLimit(
  db: Db | Tx,
  key: string,
  opts: RateLimitOptions,
): Promise<RateLimitResult> {
  const { start, retryAfterSeconds } = windowOf(opts);
  const [row] = await db
    .select({ count: rateLimitBuckets.count })
    .from(rateLimitBuckets)
    .where(and(eq(rateLimitBuckets.key, key), eq(rateLimitBuckets.windowStart, start)));
  return { allowed: (row?.count ?? 0) < opts.limit, retryAfterSeconds };
}
