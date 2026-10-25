import { and, eq, isNull } from 'drizzle-orm';
import { revokeAllSessions } from '../../auth/session';
import { withTransaction } from '../../db/client';
import { users } from '../../db/schema';
import { passwordResetTemplate } from '../../emails/templates/password-reset';
import { audit } from '../../lib/audit';
import { hashPassword } from '../../lib/crypto';
import { dispatchEmails, queueEmail } from '../../lib/email';
import { badRequest } from '../../lib/errors';
import { appUrl, auditContext, type RequestMeta } from '../../lib/request-meta';
import { consumeRateLimit, rateLimitKey } from '../../middleware/rate-limit';
import type { AppDeps } from '../../types';
import { consumeAuthToken, createAuthToken } from './auth-tokens';

/** Reset requests per e-mail per hour; beyond it requests are accepted but send nothing. */
export const RESET_REQUEST_LIMIT = { limit: 5, windowSeconds: 3600 } as const;

/**
 * Queues a reset e-mail when the address belongs to an active user. The caller answers 202 either
 * way, so the response never says whether the e-mail exists (FND-60).
 */
export async function requestPasswordReset(deps: AppDeps, email: string): Promise<void> {
  const { db, env } = deps;
  const now = deps.now();
  const limit = await consumeRateLimit(db, rateLimitKey('reset-request', email), {
    ...RESET_REQUEST_LIMIT,
    now,
  });
  if (!limit.allowed) return;

  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.email, email), eq(users.status, 'active'), isNull(users.deletedAt)));
  if (user === undefined) return;

  const emailId = await withTransaction(db, async (tx) => {
    const token = await createAuthToken(tx, { userId: user.id, purpose: 'password_reset', now });
    const link = appUrl(env, `/redefinir-senha?token=${token}`);
    return queueEmail(tx, {
      to: user.email,
      template: 'auth.password_reset',
      ...passwordResetTemplate({ name: user.name, link }),
    });
  });
  await dispatchEmails(db, [emailId], { env, fetch: deps.fetch });
}

/**
 * Spends the token, replaces the password hash, revokes every session of the user and audits it,
 * all or nothing (FND-61, FND-62).
 */
export async function confirmPasswordReset(
  deps: AppDeps,
  input: { token: string; password: string },
  meta: RequestMeta,
): Promise<void> {
  const now = deps.now();
  const passwordHash = await hashPassword(input.password);
  const done = await withTransaction(deps.db, async (tx) => {
    const userId = await consumeAuthToken(tx, {
      token: input.token,
      purpose: 'password_reset',
      now,
    });
    if (userId === null) return false;
    const [user] = await tx
      .update(users)
      .set({ passwordHash, updatedAt: now })
      .where(eq(users.id, userId))
      .returning({ id: users.id, role: users.role });
    if (user === undefined) return false;
    await revokeAllSessions(tx, userId, now);
    await audit(tx, auditContext(meta, user), {
      action: 'auth.password_reset',
      entityType: 'user',
      entityId: userId,
    });
    return true;
  });
  if (!done) throw badRequest('INVALID_TOKEN', 'Link inválido ou expirado');
}
