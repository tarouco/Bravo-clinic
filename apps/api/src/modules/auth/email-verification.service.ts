import { and, eq, isNull } from 'drizzle-orm';
import type { AuthContext } from '../../auth/session';
import { withTransaction, type Tx } from '../../db/client';
import { users } from '../../db/schema';
import { verifyEmailTemplate } from '../../emails/templates/verify-email';
import type { Env } from '../../env';
import { dispatchEmails, queueEmail } from '../../lib/email';
import { badRequest, conflict, tooManyRequests, unauthorized } from '../../lib/errors';
import { appUrl } from '../../lib/request-meta';
import { consumeRateLimit, rateLimitKey } from '../../middleware/rate-limit';
import type { AppDeps } from '../../types';
import { consumeAuthToken, createAuthToken } from './auth-tokens';

/** Resend verification: 3 per user per hour (FND-50). */
export const RESEND_LIMIT = { limit: 3, windowSeconds: 3600 } as const;

/** Creates a 24-hour verification token and queues the `auth.verify_email` message in `tx`. */
export async function queueVerificationEmail(
  tx: Tx,
  ctx: { env: Pick<Env, 'APP_BASE_URL'>; now: Date },
  user: { id: string; name: string; email: string },
): Promise<string> {
  const token = await createAuthToken(tx, {
    userId: user.id,
    purpose: 'email_verify',
    now: ctx.now,
  });
  const link = appUrl(ctx.env, `/verificar-email?token=${token}`);
  return queueEmail(tx, {
    to: user.email,
    template: 'auth.verify_email',
    ...verifyEmailTemplate({ name: user.name, link }),
  });
}

/** Redeems a verification link: sets `email_verified_at` and spends the token (FND-48, FND-49). */
export async function verifyEmail(deps: AppDeps, token: string): Promise<void> {
  const now = deps.now();
  const verified = await withTransaction(deps.db, async (tx) => {
    const userId = await consumeAuthToken(tx, { token, purpose: 'email_verify', now });
    if (userId === null) return false;
    await tx
      .update(users)
      .set({ emailVerifiedAt: now, updatedAt: now })
      .where(and(eq(users.id, userId), isNull(users.emailVerifiedAt)));
    return true;
  });
  if (!verified) throw badRequest('INVALID_TOKEN', 'Link inválido ou expirado');
}

/** Sends a new verification e-mail to the signed-in user, at most 3 per hour (FND-50). */
export async function resendVerification(deps: AppDeps, auth: AuthContext): Promise<void> {
  const { db, env } = deps;
  const now = deps.now();
  const [user] = await db.select().from(users).where(eq(users.id, auth.userId));
  if (user === undefined) throw unauthorized();
  if (user.emailVerifiedAt !== null) throw conflict('CONFLICT', 'E-mail já verificado');

  const limit = await consumeRateLimit(db, rateLimitKey('verify-resend', user.id), {
    ...RESEND_LIMIT,
    now,
  });
  if (!limit.allowed) throw tooManyRequests(limit.retryAfterSeconds);

  const emailId = await withTransaction(db, (tx) => queueVerificationEmail(tx, { env, now }, user));
  await dispatchEmails(db, [emailId], { env, fetch: deps.fetch });
}
