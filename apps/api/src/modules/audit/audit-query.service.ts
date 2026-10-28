import { addDays, localToUtc, type AuditQuery } from '@bravo/core';
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import type { Db, Tx } from '../../db/client';
import { auditLog, users } from '../../db/schema';
import { validationFailed } from '../../lib/errors';

// `GET /admin/audit` (GES-115): the append-only audit log, newest first, filtered and paged by a
// keyset cursor on `(at, id)`. The ids are bigints and rows of one transaction share `at` to the
// microsecond, so the cursor carries Postgres's own text of `at` (a JS Date keeps milliseconds).

interface AuditCursor {
  at: string;
  id: number;
}

const encode = (c: AuditCursor) =>
  Buffer.from(JSON.stringify([c.at, c.id]), 'utf8').toString('base64url');

/** `2027-03-02 15:00:00.123456+00`, Postgres's text of a timestamptz. */
const TIMESTAMP_TEXT = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:\d{2})?$/;

function decode(raw: string): AuditCursor {
  const invalid = () => validationFailed([{ path: ['cursor'], message: 'Cursor inválido' }]);
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (!Array.isArray(parsed) || typeof parsed[0] !== 'string' || !Number.isInteger(parsed[1])) {
      throw invalid();
    }
    if (!TIMESTAMP_TEXT.test(parsed[0])) throw invalid();
    return { at: parsed[0], id: parsed[1] as number };
  } catch {
    throw invalid();
  }
}

const escapeLike = (text: string) => text.replace(/[\\%_]/g, (char) => `\\${char}`);

export async function listAuditLog(db: Db | Tx, query: AuditQuery) {
  const after = query.cursor === undefined ? undefined : decode(query.cursor);
  const rows = await db
    .select({ entry: auditLog, atText: sql<string>`${auditLog.at}::text`, actorName: users.name })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.actorUserId))
    .where(
      and(
        query.actorId === undefined ? undefined : eq(auditLog.actorUserId, query.actorId),
        query.origin === undefined ? undefined : eq(auditLog.origin, query.origin),
        query.actionPrefix === undefined || query.actionPrefix === ''
          ? undefined
          : sql`${auditLog.action} like ${`${escapeLike(query.actionPrefix)}%`}`,
        query.entityType === undefined ? undefined : eq(auditLog.entityType, query.entityType),
        query.entityId === undefined ? undefined : eq(auditLog.entityId, query.entityId),
        // Local São Paulo days, both ends included.
        query.from === undefined ? undefined : gte(auditLog.at, localToUtc(query.from, 0)),
        query.to === undefined ? undefined : lt(auditLog.at, localToUtc(addDays(query.to, 1), 0)),
        after === undefined
          ? undefined
          : sql`(${auditLog.at}, ${auditLog.id}) < (${after.at}::timestamptz, ${after.id})`,
      ),
    )
    .orderBy(desc(auditLog.at), desc(auditLog.id))
    .limit(query.limit + 1);
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page.map(({ entry: e, actorName }) => ({
      id: e.id,
      at: e.at.toISOString(),
      actorUserId: e.actorUserId,
      actorName,
      actorRole: e.actorRole,
      origin: e.origin,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId,
      justification: e.justification,
      before: e.before,
      after: e.after,
    })),
    nextCursor:
      rows.length > query.limit && last !== undefined
        ? encode({ at: last.atText, id: last.entry.id })
        : null,
  };
}
