import type { McpTokenInput } from '@bravo/core';
import { and, desc, eq, isNull, lt, or } from 'drizzle-orm';
import type { AuthContext } from '../../auth/session';
import type { Db, Tx } from '../../db/client';
import { mcpTokens, users } from '../../db/schema';
import { audit, type RequestContext } from '../../lib/audit';
import { randomToken, sha256Hex } from '../../lib/crypto';
import { notFound } from '../../lib/errors';

// Revocable MCP bearer tokens (GES-53, GES-54, GES-56, GES-64). The raw `bmcp_...` token is shown
// once; only its SHA-256 and a short display prefix are stored.

export const MCP_TOKEN_PATTERN = /^bmcp_[A-Za-z0-9_-]{43}$/;
/** `bmcp_` plus the first 6 characters of the random part. */
const PREFIX_LENGTH = 11;
const DAY_MS = 86_400_000;
const LAST_USED_RESOLUTION_MS = 60_000;

type TokenRow = typeof mcpTokens.$inferSelect;

/** `McpTokenView` of design "Data Models": never the raw token or its hash. */
export function tokenView(row: TokenRow) {
  return {
    id: row.id,
    name: row.name,
    scope: row.scope as 'read' | 'read_write',
    prefix: row.tokenPrefix,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}
export type McpTokenView = ReturnType<typeof tokenView>;

/** Issues a token owned by the acting admin (GES-53). */
export async function issueToken(
  tx: Tx,
  ctx: RequestContext,
  input: McpTokenInput,
  now: Date,
): Promise<{ token: string; record: McpTokenView }> {
  if (ctx.actorUserId === null) throw new Error('issueToken: an owner is required');
  const token = `bmcp_${randomToken()}`;
  const [row] = await tx
    .insert(mcpTokens)
    .values({
      name: input.name,
      ownerUserId: ctx.actorUserId,
      scope: input.scope,
      tokenHash: sha256Hex(token),
      tokenPrefix: token.slice(0, PREFIX_LENGTH),
      createdAt: now,
      expiresAt:
        input.expiresInDays === undefined
          ? null
          : new Date(now.getTime() + input.expiresInDays * DAY_MS),
    })
    .returning();
  if (row === undefined) throw new Error('issueToken: insert returned no row');
  const record = tokenView(row);
  await audit(tx, ctx, {
    action: 'mcp_token.issue',
    entityType: 'mcp_token',
    entityId: row.id,
    after: {
      name: record.name,
      scope: record.scope,
      prefix: record.prefix,
      expiresAt: record.expiresAt,
    },
  });
  return { token, record };
}

/** Every token, newest first, revoked ones included (GES-54). */
export async function listTokens(db: Db | Tx): Promise<McpTokenView[]> {
  const rows = await db.select().from(mcpTokens).orderBy(desc(mcpTokens.createdAt));
  return rows.map(tokenView);
}

/** Sets `revoked_at` with audit; 404 when unknown or already revoked (GES-54). */
export async function revokeToken(tx: Tx, ctx: RequestContext, id: string, now: Date) {
  const [row] = await tx
    .update(mcpTokens)
    .set({ revokedAt: now })
    .where(and(eq(mcpTokens.id, id), isNull(mcpTokens.revokedAt)))
    .returning();
  if (row === undefined) throw notFound();
  await audit(tx, ctx, {
    action: 'mcp_token.revoke',
    entityType: 'mcp_token',
    entityId: id,
    before: { name: row.name, scope: row.scope, prefix: row.tokenPrefix },
  });
}

export interface McpPrincipal {
  token: TokenRow;
  owner: AuthContext;
}

/**
 * The token of an `Authorization: Bearer bmcp_...` header, or null when it is missing, malformed,
 * unknown, revoked or expired, or its owner is no longer an active admin (GES-56). Records
 * `last_used_at` at most once per minute (GES-64).
 */
export async function authenticateBearer(
  db: Db,
  header: string | undefined,
  now: Date,
): Promise<McpPrincipal | null> {
  const match = /^Bearer\s+(\S+)$/i.exec(header?.trim() ?? '');
  const raw = match?.[1];
  if (raw === undefined || !MCP_TOKEN_PATTERN.test(raw)) return null;
  const [row] = await db
    .select({ token: mcpTokens, owner: { role: users.role, status: users.status } })
    .from(mcpTokens)
    .innerJoin(users, eq(users.id, mcpTokens.ownerUserId))
    .where(eq(mcpTokens.tokenHash, sha256Hex(raw)));
  if (row === undefined) return null;
  const { token, owner } = row;
  if (token.revokedAt !== null) return null;
  if (token.expiresAt !== null && token.expiresAt.getTime() <= now.getTime()) return null;
  if (owner.role !== 'admin' || owner.status !== 'active') return null;

  await db
    .update(mcpTokens)
    .set({ lastUsedAt: now })
    .where(
      and(
        eq(mcpTokens.id, token.id),
        or(
          isNull(mcpTokens.lastUsedAt),
          lt(mcpTokens.lastUsedAt, new Date(now.getTime() - LAST_USED_RESOLUTION_MS)),
        ),
      ),
    );
  return {
    token,
    owner: {
      userId: token.ownerUserId,
      role: 'admin',
      sessionId: `mcp:${token.id}`,
      mfaVerified: true,
      totpConfirmed: true,
    },
  };
}
