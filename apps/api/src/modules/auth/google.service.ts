import { isStaff } from '@bravo/core';
import { eq, or } from 'drizzle-orm';
import {
  buildAuthorizationUrl,
  createPkce,
  decodeStateCookie,
  encodeStateCookie,
  exchangeCode,
  googleCredentials,
  googleJwks,
  verifyIdToken,
  type GoogleCredentials,
  type GoogleProfile,
} from '../../auth/google';
import { issueSession, revokeAllSessions } from '../../auth/session';
import { withTransaction, type Tx } from '../../db/client';
import { users } from '../../db/schema';
import { audit } from '../../lib/audit';
import { badRequest, notFound } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { appUrl, auditContext, type RequestMeta } from '../../lib/request-meta';
import type { AppDeps } from '../../types';

const CALLBACK_PATH = '/api/public/auth/google/callback';
const FAILURE_MESSAGE = 'Não foi possível entrar com o Google.';

function requireCredentials(deps: AppDeps): GoogleCredentials {
  const credentials = googleCredentials(deps.env);
  if (credentials === null) throw notFound('FEATURE_DISABLED', 'Login com Google indisponível');
  return credentials;
}

/** The browser-facing callback URL (through the `/api` proxy), registered in the Google console. */
const redirectUriOf = (deps: AppDeps) => appUrl(deps.env, CALLBACK_PATH);

/** Authorization URL plus the value of the state cookie that must come back on the callback. */
export function startGoogleLogin(deps: AppDeps): { url: string; stateCookie: string } {
  const credentials = requireCredentials(deps);
  const pkce = createPkce();
  return {
    url: buildAuthorizationUrl({
      clientId: credentials.clientId,
      redirectUri: redirectUriOf(deps),
      state: pkce.state,
      challenge: pkce.challenge,
    }),
    stateCookie: encodeStateCookie(pkce),
  };
}

type UserRow = typeof users.$inferSelect;

async function findOrCreateUser(tx: Tx, profile: GoogleProfile, now: Date): Promise<UserRow> {
  const [existing] = await tx
    .select()
    .from(users)
    .where(or(eq(users.googleSub, profile.sub), eq(users.email, profile.email)));
  if (existing === undefined) {
    const [created] = await tx
      .insert(users)
      .values({
        role: 'tenant',
        name: displayName(profile),
        email: profile.email,
        emailVerifiedAt: now,
        googleSub: profile.sub,
      })
      .returning();
    if (created === undefined) throw new Error('google login: insert returned no row');
    return created;
  }
  if (existing.status !== 'active' || existing.deletedAt !== null)
    throw badRequest('BAD_REQUEST', FAILURE_MESSAGE);
  if (existing.googleSub === profile.sub) return existing;
  // Same e-mail, no Google link yet. A different Google account already linked is refused.
  if (existing.googleSub !== null) throw badRequest('BAD_REQUEST', FAILURE_MESSAGE);

  const wasVerified = existing.emailVerifiedAt !== null;
  const [linked] = await tx
    .update(users)
    .set({
      googleSub: profile.sub,
      emailVerifiedAt: existing.emailVerifiedAt ?? now,
      // An account whose e-mail was never verified may have been registered by someone else with
      // that address; Google has now proven who owns it, so drop that password and its sessions.
      ...(wasVerified ? {} : { passwordHash: null }),
      updatedAt: now,
    })
    .where(eq(users.id, existing.id))
    .returning();
  if (linked === undefined) throw new Error('google login: update returned no row');
  if (!wasVerified) await revokeAllSessions(tx, existing.id, now);
  return linked;
}

function displayName(profile: GoogleProfile): string {
  const name = (profile.name ?? profile.email.split('@')[0] ?? '').trim().slice(0, 120);
  return name.length >= 2 ? name : 'Usuário';
}

export interface GoogleLoginResult {
  session: { token: string; maxAgeSeconds: number };
  redirectTo: string;
}

/**
 * Completes the OAuth code flow: checks the state cookie (FND-133), exchanges the code, verifies the
 * ID token, then logs in or creates the user (FND-132).
 */
export async function finishGoogleLogin(
  deps: AppDeps,
  input: { code: string | undefined; state: string | undefined; stateCookie: string | undefined },
  meta: RequestMeta,
): Promise<GoogleLoginResult> {
  const credentials = requireCredentials(deps);
  const saved = decodeStateCookie(input.stateCookie);
  if (saved === null || input.state === undefined || input.state !== saved.state) {
    throw badRequest('INVALID_STATE', 'Estado de login inválido');
  }
  if (input.code === undefined || input.code === '')
    throw badRequest('BAD_REQUEST', FAILURE_MESSAGE);

  let profile: GoogleProfile;
  try {
    const idToken = await exchangeCode({
      fetch: deps.fetch,
      credentials,
      redirectUri: redirectUriOf(deps),
      code: input.code,
      verifier: saved.verifier,
    });
    profile = await verifyIdToken(idToken, {
      clientId: credentials.clientId,
      jwks: deps.googleJwks ?? googleJwks(),
    });
  } catch (error) {
    logger.warn('google login failed', {
      requestId: meta.requestId,
      reason: error instanceof Error ? error.message : 'unknown',
    });
    throw badRequest('BAD_REQUEST', FAILURE_MESSAGE);
  }

  const now = deps.now();
  return withTransaction(deps.db, async (tx) => {
    const user = await findOrCreateUser(tx, profile, now);
    const role = user.role as 'tenant' | 'reception' | 'admin';
    await tx.update(users).set({ lastLoginAt: now }).where(eq(users.id, user.id));
    const session = await issueSession(
      tx,
      deps.env.SESSION_SECRET,
      { id: user.id, role },
      { mfaVerified: false, ip: meta.ip, userAgent: meta.userAgent, now },
    );
    if (isStaff(role)) {
      await audit(tx, auditContext(meta, { id: user.id, role }), {
        action: 'auth.login_staff',
        entityType: 'user',
        entityId: user.id,
        after: { method: 'google' },
      });
    }
    return {
      session: { token: session.token, maxAgeSeconds: session.maxAgeSeconds },
      redirectTo: user.docNumber === null ? '/app/perfil?completar=1' : '/app',
    };
  });
}
