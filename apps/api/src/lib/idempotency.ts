import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';
import { idempotencyKeys } from '../db/schema';
import type { AppEnv } from '../types';
import { sha256Hex } from './crypto';
import { AppError, badRequest, conflict } from './errors';

// `Idempotency-Key` for client mutations that move money (docs/architecture.md section 6.8).
// The key is stored per user *before* the handler runs; a replay returns the stored response, the
// same key with another request is a 422, and rows expire after 24 h.

const KEY_FORMAT = /^[A-Za-z0-9_-]{8,128}$/;
const TTL_MS = 24 * 3_600_000;
/** A row that never got a response (crashed function) can be taken over after this long. */
const ABANDONED_AFTER_MS = 60_000;

/** JSON with sorted object keys, so key order never changes the request hash. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, inner]) => `${JSON.stringify(key)}:${canonical(inner)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function requestHash(method: string, path: string, rawBody: string): string {
  let body = rawBody;
  try {
    body = canonical(JSON.parse(rawBody));
  } catch {
    // Not JSON: the raw text is the identity of the request.
  }
  return sha256Hex(`${method} ${path}\n${body}`);
}

export const idempotencyMismatch = () =>
  new AppError(
    422,
    'IDEMPOTENCY_MISMATCH',
    'Esta chave de idempotência já foi usada em outra requisição.',
  );

/**
 * Middleware for money-moving POSTs behind `requireAuth`. Missing or malformed key: 400; replay of
 * the same request: the stored status and body; same key, other request: 422
 * `IDEMPOTENCY_MISMATCH`; same request still running: 409. Unexpected 5xx answers (other than
 * 502 gateway errors, which are stored as designed) are forgotten so the client may retry.
 */
export function idempotent(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const key = c.req.header('Idempotency-Key');
    if (key === undefined || !KEY_FORMAT.test(key)) {
      throw badRequest('BAD_REQUEST', 'Cabeçalho Idempotency-Key ausente ou inválido');
    }
    const { db, now } = c.var.deps;
    const userId = c.get('auth').userId;
    const at = now();
    const route = `${c.req.method} ${c.req.path}`;
    const hash = requestHash(c.req.method, c.req.path, await c.req.text());
    const expiresAt = new Date(at.getTime() + TTL_MS);

    // Claim the key, or take over an expired row; a live row is left as it is.
    const [claimed] = await db
      .insert(idempotencyKeys)
      .values({ userId, key, route, requestHash: hash, createdAt: at, expiresAt })
      .onConflictDoUpdate({
        target: [idempotencyKeys.userId, idempotencyKeys.key],
        set: {
          route,
          requestHash: hash,
          responseStatus: null,
          responseBody: null,
          createdAt: at,
          expiresAt,
        },
        setWhere: sql`${idempotencyKeys.expiresAt} <= ${at.toISOString()}::timestamptz`,
      })
      .returning({ key: idempotencyKeys.key });

    if (claimed === undefined) {
      const [existing] = await db
        .select()
        .from(idempotencyKeys)
        .where(and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, key)));
      if (existing === undefined) throw conflict(); // deleted between the two statements
      if (existing.route !== route || existing.requestHash !== hash) throw idempotencyMismatch();
      if (existing.responseStatus !== null) {
        c.header('Idempotent-Replayed', 'true');
        return existing.responseBody === null
          ? c.body(null, existing.responseStatus as 204)
          : c.json(existing.responseBody, existing.responseStatus as 200);
      }
      const abandonedBefore = new Date(at.getTime() - ABANDONED_AFTER_MS);
      const [taken] = await db
        .update(idempotencyKeys)
        .set({ createdAt: at })
        .where(
          and(
            eq(idempotencyKeys.userId, userId),
            eq(idempotencyKeys.key, key),
            isNull(idempotencyKeys.responseStatus),
            lt(idempotencyKeys.createdAt, abandonedBefore),
          ),
        )
        .returning({ key: idempotencyKeys.key });
      if (taken === undefined) {
        throw conflict('REQUEST_IN_PROGRESS', 'Esta requisição ainda está em andamento.');
      }
    }

    await next();

    const status = c.res.status;
    const forget = status >= 500 && status !== 502;
    if (forget) {
      await db
        .delete(idempotencyKeys)
        .where(and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, key)));
      return;
    }
    const text = await c.res.clone().text();
    let body: unknown = null;
    if (text !== '') {
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
    }
    await db
      .update(idempotencyKeys)
      .set({ responseStatus: status, responseBody: body })
      .where(and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, key)));
  };
}
