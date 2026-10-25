import type { Tx } from '../db/client';
import { auditLog } from '../db/schema';
import { redact } from './logger';

export type AuditOrigin = 'web' | 'app' | 'admin' | 'mcp' | 'job' | 'system';

/** Who is acting and from where; built per request and passed to `audit()`. */
export interface RequestContext {
  actorUserId: string | null;
  actorRole: string | null;
  origin: AuditOrigin;
  ip: string | null;
  requestId: string | null;
}

export interface AuditInput {
  action: string;
  entityType: string;
  entityId?: string;
  justification?: string;
  before?: unknown;
  after?: unknown;
}

/** Origin of a request by its native path prefix; public routes and unknown paths count as web. */
export function originFromPath(path: string): AuditOrigin {
  if (path === '/admin' || path.startsWith('/admin/')) return 'admin';
  if (path === '/app' || path.startsWith('/app/')) return 'app';
  return 'web';
}

/** Appends to `audit_log` in the caller's transaction, so a rollback removes the entry too. */
export async function audit(tx: Tx, ctx: RequestContext, input: AuditInput): Promise<void> {
  await tx.insert(auditLog).values({
    actorUserId: ctx.actorUserId,
    actorRole: ctx.actorRole,
    origin: ctx.origin,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    justification: input.justification ?? null,
    before: input.before === undefined ? null : redact(input.before),
    after: input.after === undefined ? null : redact(input.after),
    ip: ctx.ip,
    requestId: ctx.requestId,
  });
}
