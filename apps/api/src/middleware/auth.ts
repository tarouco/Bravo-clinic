import { isStaff, type Role } from '@bravo/core';
import { eq } from 'drizzle-orm';
import { getCookie } from 'hono/cookie';
import type { MiddlewareHandler } from 'hono';
import { resolveSession, SESSION_COOKIE } from '../auth/session';
import { users } from '../db/schema';
import { forbidden, unauthorized } from '../lib/errors';
import type { AppEnv } from '../types';

/** Any valid, unrevoked session; sets `c.var.auth`. Role and TOTP state are read from the database. */
export function requireAuth(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token === undefined) throw unauthorized();
    const { db, env, now } = c.var.deps;
    const auth = await resolveSession(db, token, env.SESSION_SECRET, now());
    if (auth === null) throw unauthorized();
    c.set('auth', auth);
    c.set('userId', auth.userId);
    await next();
  };
}

/**
 * Endpoints a session still waiting for its second factor may call: the session query the web
 * app reads, the 2FA step itself and logout (AD-037).
 */
export const MFA_PENDING_ALLOWED = new Set([
  'GET /app/me',
  'POST /app/auth/totp/verify',
  'POST /app/auth/logout',
]);

const mfaRequired = () => forbidden('MFA_REQUIRED', 'Confirme a verificação em duas etapas');

/**
 * Two-factor authentication is optional for every role (AD-037, user decision 2026-10-28): a user
 * with a confirmed TOTP must finish the second factor before anything outside
 * `MFA_PENDING_ALLOWED`; everyone else passes. Runs after `requireAuth`.
 */
export function requireMfaIfEnrolled(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const auth = c.get('auth');
    if (
      auth.totpConfirmed &&
      !auth.mfaVerified &&
      !MFA_PENDING_ALLOWED.has(`${c.req.method} ${c.req.path}`)
    ) {
      throw mfaRequired();
    }
    await next();
  };
}

/**
 * Admin or reception. Staff without TOTP pass with a password session; staff with a confirmed
 * TOTP need an MFA-verified session (AD-037). Runs after `requireAuth`.
 */
export function requireStaff(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const auth = c.get('auth');
    if (!isStaff(auth.role)) throw forbidden();
    if (auth.totpConfirmed && !auth.mfaVerified) throw mfaRequired();
    await next();
  };
}

/** Restricts a route to one role; reception hitting `requireRole('admin')` gets 403 FORBIDDEN. */
export function requireRole(role: Extract<Role, 'admin'>): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (c.get('auth').role !== role) throw forbidden();
    await next();
  };
}

/** Booking creation needs a verified e-mail (NUC-89). Runs after `requireAuth`. */
export function requireVerifiedEmail(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const [user] = await c.var.deps.db
      .select({ verifiedAt: users.emailVerifiedAt })
      .from(users)
      .where(eq(users.id, c.get('auth').userId));
    if (user === undefined) throw unauthorized();
    if (user.verifiedAt === null) {
      throw forbidden('EMAIL_NOT_VERIFIED', 'Confirme seu e-mail para reservar.');
    }
    await next();
  };
}
