import { isStaff, type LoginInput } from '@bravo/core';
import { eq } from 'drizzle-orm';
import { issueSession, revokeSession, type AuthContext } from '../../auth/session';
import { withTransaction, type Db } from '../../db/client';
import { userTotp, users } from '../../db/schema';
import { audit } from '../../lib/audit';
import { hashPassword, randomToken, verifyPassword } from '../../lib/crypto';
import { tooManyRequests, unauthorized } from '../../lib/errors';
import { auditContext, type RequestMeta } from '../../lib/request-meta';
import { consumeRateLimit, peekRateLimit, rateLimitKey } from '../../middleware/rate-limit';
import type { AppDeps } from '../../types';
import { toUserPayload, type UserPayload } from './user-payload';

/** Failed logins allowed per window before the next attempt is refused (FND-54, architecture 6.4). */
export const LOGIN_EMAIL_LIMIT = { limit: 5, windowSeconds: 900 } as const;
export const LOGIN_IP_LIMIT = { limit: 30, windowSeconds: 900 } as const;

export const loginRateKey = {
  email: (email: string) => rateLimitKey('login:email', email),
  ip: (ip: string) => rateLimitKey('login:ip', ip),
};

export const INVALID_CREDENTIALS_MESSAGE = 'E-mail ou senha incorretos';

export interface LoginResult {
  user: UserPayload;
  mfaRequired: boolean;
  session: { token: string; maxAgeSeconds: number };
}

// Unknown e-mails are verified against this hash so they cost as much time as a wrong password.
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= hashPassword(randomToken()));

/**
 * Verifies credentials behind two failure counters (per e-mail and per IP). The counters are
 * checked first, so a locked-out e-mail is refused even with the right password.
 */
export async function login(
  deps: AppDeps,
  input: LoginInput,
  meta: RequestMeta,
): Promise<LoginResult> {
  const { db, env } = deps;
  const now = deps.now();
  const emailKey = loginRateKey.email(input.email);
  const ipKey = meta.ip === null ? null : loginRateKey.ip(meta.ip);

  const [byEmail, byIp] = await Promise.all([
    peekRateLimit(db, emailKey, { ...LOGIN_EMAIL_LIMIT, now }),
    ipKey === null ? null : peekRateLimit(db, ipKey, { ...LOGIN_IP_LIMIT, now }),
  ]);
  if (!byEmail.allowed) throw tooManyRequests(byEmail.retryAfterSeconds);
  if (byIp !== null && !byIp.allowed) throw tooManyRequests(byIp.retryAfterSeconds);

  const [found] = await db
    .select({ user: users, totpConfirmedAt: userTotp.confirmedAt })
    .from(users)
    .leftJoin(userTotp, eq(userTotp.userId, users.id))
    .where(eq(users.email, input.email));
  const user = found?.user;

  const passwordOk = await verifyPassword(
    input.password,
    user?.passwordHash ?? (await getDummyHash()),
  );
  if (
    found === undefined ||
    user === undefined ||
    user.passwordHash === null ||
    !passwordOk ||
    user.status !== 'active' ||
    user.deletedAt !== null
  ) {
    // Counted on the pool, outside any transaction, so the failure is kept.
    await Promise.all([
      consumeRateLimit(db, emailKey, { ...LOGIN_EMAIL_LIMIT, now }),
      ipKey === null ? null : consumeRateLimit(db, ipKey, { ...LOGIN_IP_LIMIT, now }),
    ]);
    throw unauthorized('INVALID_CREDENTIALS', INVALID_CREDENTIALS_MESSAGE);
  }

  const role = user.role as UserPayload['role'];
  const totpConfirmed = found.totpConfirmedAt !== null;
  // Opt-in for every role (AD-037): whoever turned TOTP on finishes the second factor.
  const mfaRequired = totpConfirmed;
  const session = await withTransaction(db, async (tx) => {
    await tx.update(users).set({ lastLoginAt: now }).where(eq(users.id, user.id));
    const issued = await issueSession(
      tx,
      env.SESSION_SECRET,
      { id: user.id, role },
      { mfaVerified: false, ip: meta.ip, userAgent: meta.userAgent, now },
    );
    if (isStaff(role)) {
      await audit(tx, auditContext(meta, { id: user.id, role }), {
        action: 'auth.login_staff',
        entityType: 'user',
        entityId: user.id,
        after: { mfaRequired },
      });
    }
    return issued;
  });

  return {
    user: toUserPayload(user, { enrolled: totpConfirmed, verified: false }),
    mfaRequired,
    session: { token: session.token, maxAgeSeconds: session.maxAgeSeconds },
  };
}

/** Revokes the caller's session row (FND-55). */
export async function logout(db: Db, auth: AuthContext): Promise<void> {
  await withTransaction(db, (tx) => revokeSession(tx, auth.sessionId));
}

/** The caller as `GET /app/me` returns it (FND-57). */
export async function getMe(db: Db, auth: AuthContext): Promise<UserPayload> {
  const [user] = await db.select().from(users).where(eq(users.id, auth.userId));
  if (user === undefined) throw unauthorized();
  return toUserPayload(user, { enrolled: auth.totpConfirmed, verified: auth.mfaVerified });
}
