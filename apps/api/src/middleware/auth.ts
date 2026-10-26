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

/** Admin or reception with confirmed TOTP and an MFA-verified session. Runs after `requireAuth`. */
export function requireStaff(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const auth = c.get('auth');
    if (!isStaff(auth.role)) throw forbidden();
    if (!auth.totpConfirmed) {
      throw forbidden('MFA_ENROLLMENT_REQUIRED', 'Cadastre a verificação em duas etapas');
    }
    if (!auth.mfaVerified) {
      throw forbidden('MFA_REQUIRED', 'Confirme a verificação em duas etapas');
    }
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
