import { and, eq, gte, inArray, lt, lte, or, sql } from 'drizzle-orm';
import { authTokens, emailOutbox, idempotencyKeys, rateLimitBuckets, sessions } from '../db/schema';
import { dispatchEmails } from '../lib/email';
import type { Job } from './runner';

// Gestao maintenance jobs (GES-72, GES-129, design.md "Privacy (LGPD) and maintenance jobs").

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
/** Messages dispatched per run; the next run, 5 minutes later, takes the rest. */
const RETRY_BATCH = 100;
const MAX_ATTEMPTS = 5;

/**
 * Every 5 minutes (GES-72): re-sends outbox rows `failed` with fewer than 5 attempts created in
 * the last 48 hours, and rows still `pending` 5 minutes after creation (the request's own dispatch
 * never happened). Fresher pending rows belong to their request and are left alone.
 */
export const emailRetry: Job = async (deps, now) => {
  const retryable = and(
    eq(emailOutbox.status, 'failed'),
    lt(emailOutbox.attempts, MAX_ATTEMPTS),
    gte(emailOutbox.createdAt, new Date(now.getTime() - 2 * DAY)),
  );
  const stale = and(
    eq(emailOutbox.status, 'pending'),
    lte(emailOutbox.createdAt, new Date(now.getTime() - 5 * MINUTE)),
  );
  const rows = await deps.db
    .select({ id: emailOutbox.id, status: emailOutbox.status })
    .from(emailOutbox)
    .where(or(retryable, stale))
    .orderBy(emailOutbox.createdAt)
    .limit(RETRY_BATCH);
  const failedIds = rows.filter((row) => row.status === 'failed').map((row) => row.id);
  if (failedIds.length > 0) {
    // dispatchEmails sends only pending rows; a failure sets `failed` again with attempts + 1.
    await deps.db
      .update(emailOutbox)
      .set({ status: 'pending' })
      .where(and(inArray(emailOutbox.id, failedIds), eq(emailOutbox.status, 'failed')));
  }
  await dispatchEmails(
    deps.db,
    rows.map((row) => row.id),
    { env: deps.env, fetch: deps.fetch },
  );
  return { retried: failedIds.length, pending: rows.length - failedIds.length };
};

/**
 * Weekly (GES-129): deletes sessions and auth tokens expired, used or revoked more than 30 days
 * ago, rate-limit windows older than 2 days and expired idempotency keys, and blanks the bodies of
 * outbox rows older than 180 days (the row itself stays as the delivery record).
 */
export const retention: Job = async (deps, now) => {
  const { db } = deps;
  const monthAgo = new Date(now.getTime() - 30 * DAY);
  const deletedSessions = await db
    .delete(sessions)
    .where(or(lt(sessions.expiresAt, monthAgo), lt(sessions.revokedAt, monthAgo)))
    .returning({ id: sessions.id });
  const deletedTokens = await db
    .delete(authTokens)
    .where(or(lt(authTokens.expiresAt, monthAgo), lt(authTokens.usedAt, monthAgo)))
    .returning({ id: authTokens.id });
  const deletedBuckets = await db
    .delete(rateLimitBuckets)
    .where(lt(rateLimitBuckets.windowStart, new Date(now.getTime() - 2 * DAY)))
    .returning({ key: rateLimitBuckets.key });
  const deletedKeys = await db
    .delete(idempotencyKeys)
    .where(lt(idempotencyKeys.expiresAt, now))
    .returning({ key: idempotencyKeys.key });
  const blanked = await db
    .update(emailOutbox)
    .set({ html: '', textBody: '', attachments: sql`'[]'::jsonb` })
    .where(
      and(
        lt(emailOutbox.createdAt, new Date(now.getTime() - 180 * DAY)),
        or(
          sql`${emailOutbox.html} <> ''`,
          sql`${emailOutbox.textBody} <> ''`,
          sql`${emailOutbox.attachments} <> '[]'::jsonb`,
        ),
      ),
    )
    .returning({ id: emailOutbox.id });
  return {
    sessionsDeleted: deletedSessions.length,
    authTokensDeleted: deletedTokens.length,
    rateLimitBucketsDeleted: deletedBuckets.length,
    idempotencyKeysDeleted: deletedKeys.length,
    outboxBodiesBlanked: blanked.length,
  };
};
