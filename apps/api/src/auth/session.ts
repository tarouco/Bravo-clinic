import { isStaff, type Role } from '@bravo/core';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Context } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import { jwtVerify, SignJWT } from 'jose';
import type { Db, Tx } from '../db/client';
import { sessions, userTotp, users } from '../db/schema';

export const SESSION_COOKIE = 'bravo_session';
const TENANT_MAX_AGE_SECONDS = 2_592_000; // 30 days
const STAFF_MAX_AGE_SECONDS = 43_200; // 12 hours

export interface SessionClaims {
  /** User id. */
  sub: string;
  /** Session row id. */
  sid: string;
  role: Role;
  mfa: boolean;
  iat: number;
  exp: number;
}

/** The caller as the auth middleware sees it; `role` always comes from the user row. */
export interface AuthContext {
  userId: string;
  role: Role;
  sessionId: string;
  mfaVerified: boolean;
  totpConfirmed: boolean;
}

export function sessionMaxAgeSeconds(role: Role): number {
  return isStaff(role) ? STAFF_MAX_AGE_SECONDS : TENANT_MAX_AGE_SECONDS;
}

const signingKey = (secret: string) => new TextEncoder().encode(secret);

/** Creates the `sessions` row and the HS256 JWT that points at it. */
export async function issueSession(
  tx: Tx,
  secret: string,
  user: { id: string; role: Role },
  opts: { mfaVerified: boolean; ip?: string | null; userAgent?: string | null; now?: Date },
): Promise<{ token: string; maxAgeSeconds: number; sessionId: string }> {
  const now = opts.now ?? new Date();
  const maxAgeSeconds = sessionMaxAgeSeconds(user.role);
  const iat = Math.floor(now.getTime() / 1000);
  const [row] = await tx
    .insert(sessions)
    .values({
      userId: user.id,
      mfaVerifiedAt: opts.mfaVerified ? now : null,
      expiresAt: new Date(now.getTime() + maxAgeSeconds * 1000),
      ip: opts.ip ?? null,
      userAgent: opts.userAgent ?? null,
    })
    .returning({ id: sessions.id });
  if (row === undefined) throw new Error('issueSession: insert returned no row');
  const token = await new SignJWT({ sid: row.id, role: user.role, mfa: opts.mfaVerified })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt(iat)
    .setExpirationTime(iat + maxAgeSeconds)
    .sign(signingKey(secret));
  return { token, maxAgeSeconds, sessionId: row.id };
}

/** Signature and `exp` check only; null for anything that is not a valid session JWT. */
export async function verifySessionToken(
  token: string,
  secret: string,
  now: Date = new Date(),
): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, signingKey(secret), {
      algorithms: ['HS256'],
      currentDate: now,
    });
    const { sub, sid, role, mfa, iat, exp } = payload;
    if (
      typeof sub !== 'string' ||
      typeof sid !== 'string' ||
      (role !== 'tenant' && role !== 'reception' && role !== 'admin') ||
      typeof mfa !== 'boolean' ||
      typeof iat !== 'number' ||
      typeof exp !== 'number'
    ) {
      return null;
    }
    return { sub, sid, role, mfa, iat, exp };
  } catch {
    return null;
  }
}

/**
 * Verifies the JWT, then loads its session row: revoked or expired rows and inactive users
 * resolve to null. Role and TOTP state come from the database, so demotion applies at once.
 */
export async function resolveSession(
  db: Db,
  token: string,
  secret: string,
  now: Date = new Date(),
): Promise<AuthContext | null> {
  const claims = await verifySessionToken(token, secret, now);
  if (claims === null) return null;
  const [row] = await db
    .select({
      userId: users.id,
      role: users.role,
      sessionId: sessions.id,
      mfaVerifiedAt: sessions.mfaVerifiedAt,
      totpConfirmedAt: userTotp.confirmedAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .leftJoin(userTotp, eq(userTotp.userId, users.id))
    .where(
      and(
        eq(sessions.id, claims.sid),
        eq(sessions.userId, claims.sub),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, now),
        eq(users.status, 'active'),
        isNull(users.deletedAt),
      ),
    );
  if (row === undefined) return null;
  return {
    userId: row.userId,
    role: row.role as Role,
    sessionId: row.sessionId,
    mfaVerified: row.mfaVerifiedAt !== null,
    totpConfirmed: row.totpConfirmedAt !== null,
  };
}

export async function markSessionMfaVerified(
  tx: Tx,
  sessionId: string,
  now: Date = new Date(),
): Promise<void> {
  await tx.update(sessions).set({ mfaVerifiedAt: now }).where(eq(sessions.id, sessionId));
}

export async function revokeSession(
  tx: Tx,
  sessionId: string,
  now: Date = new Date(),
): Promise<void> {
  await tx
    .update(sessions)
    .set({ revokedAt: now })
    .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
}

/** Revokes every still-active session of the user (password reset, forced logout). */
export async function revokeAllSessions(
  tx: Tx,
  userId: string,
  now: Date = new Date(),
): Promise<void> {
  await tx
    .update(sessions)
    .set({ revokedAt: now })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}

export function setSessionCookie(c: Context, token: string, maxAgeSeconds: number): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: maxAgeSeconds,
  });
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, { httpOnly: true, secure: true, sameSite: 'Lax', path: '/' });
}
