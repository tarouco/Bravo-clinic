import type { TotpDisableResponse } from '@bravo/core';
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { markSessionMfaVerified, type AuthContext } from '../../auth/session';
import {
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  isRecoveryCode,
  otpauthUri,
  verifyTotp,
} from '../../auth/totp';
import { withTransaction, type Tx } from '../../db/client';
import { sessions, userTotp, users } from '../../db/schema';
import { audit } from '../../lib/audit';
import { decryptSecret, encryptSecret } from '../../lib/crypto';
import { conflict, forbidden, tooManyRequests, unauthorized } from '../../lib/errors';
import { auditContext, type RequestMeta } from '../../lib/request-meta';
import { consumeRateLimit, peekRateLimit, rateLimitKey } from '../../middleware/rate-limit';
import type { AppDeps } from '../../types';

/** Invalid codes allowed per user per window before every attempt is refused (FND-69). */
export const TOTP_FAILURE_LIMIT = { limit: 5, windowSeconds: 900 } as const;
const failureKey = (userId: string) => rateLimitKey('totp', userId);

const INVALID_CODE_MESSAGE = 'Código inválido';

const NOT_ACTIVE_MESSAGE = 'A verificação em duas etapas não está ativa';

async function assertNotLocked(deps: AppDeps, userId: string, now: Date): Promise<void> {
  const gate = await peekRateLimit(deps.db, failureKey(userId), { ...TOTP_FAILURE_LIMIT, now });
  if (!gate.allowed) throw tooManyRequests(gate.retryAfterSeconds);
}

/** Counts one invalid code (on the pool, so it survives the request) and answers 401. */
async function rejectCode(deps: AppDeps, userId: string, now: Date): Promise<never> {
  await consumeRateLimit(deps.db, failureKey(userId), { ...TOTP_FAILURE_LIMIT, now });
  throw unauthorized('INVALID_CODE', INVALID_CODE_MESSAGE);
}

/**
 * Stores a fresh encrypted, unconfirmed secret and returns the URI for the QR code. Open to every
 * role: two-factor authentication is opt-in (FND-64, FND-135).
 */
export async function enrollTotp(
  deps: AppDeps,
  auth: AuthContext,
): Promise<{ otpauthUri: string }> {
  const { db, env } = deps;
  const now = deps.now();
  const [user] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, auth.userId));
  if (user === undefined) throw unauthorized();

  const secret = generateTotpSecret();
  const secretCiphertext = encryptSecret(secret, env.ENCRYPTION_KEY);
  // A confirmed secret is never replaced here: a password-only session could otherwise swap in its
  // own authenticator and skip the second factor.
  const written = await db
    .insert(userTotp)
    .values({ userId: auth.userId, secretCiphertext })
    .onConflictDoUpdate({
      target: userTotp.userId,
      set: {
        secretCiphertext,
        lastUsedStep: null,
        recoveryCodeHashes: sql`'{}'::text[]`,
        updatedAt: now,
      },
      setWhere: isNull(userTotp.confirmedAt),
    })
    .returning({ userId: userTotp.userId });
  if (written.length === 0) {
    throw conflict('CONFLICT', 'A verificação em duas etapas já está ativa');
  }
  return { otpauthUri: otpauthUri(secret, user.email) };
}

/**
 * Activates TOTP with the first valid code: returns the ten recovery codes (shown once), marks the
 * session MFA-verified and audits it (FND-65).
 */
export async function confirmTotp(
  deps: AppDeps,
  auth: AuthContext,
  code: string,
  meta: RequestMeta,
): Promise<{ recoveryCodes: string[] }> {
  const { db, env } = deps;
  const now = deps.now();
  await assertNotLocked(deps, auth.userId, now);

  const [row] = await db.select().from(userTotp).where(eq(userTotp.userId, auth.userId));
  if (row === undefined || row.confirmedAt !== null) {
    throw conflict('CONFLICT', 'Não há verificação em duas etapas pendente de confirmação');
  }
  const verdict = verifyTotp(
    decryptSecret(row.secretCiphertext, env.ENCRYPTION_KEY),
    code,
    null,
    now,
  );
  if (!verdict.ok) return rejectCode(deps, auth.userId, now);

  const recoveryCodes = generateRecoveryCodes();
  await withTransaction(db, async (tx) => {
    const confirmed = await tx
      .update(userTotp)
      .set({
        confirmedAt: now,
        lastUsedStep: verdict.step,
        recoveryCodeHashes: recoveryCodes.map(hashRecoveryCode),
        updatedAt: now,
      })
      .where(and(eq(userTotp.userId, auth.userId), isNull(userTotp.confirmedAt)))
      .returning({ userId: userTotp.userId });
    if (confirmed.length === 0)
      throw conflict('CONFLICT', 'A verificação em duas etapas já está ativa');
    await markSessionMfaVerified(tx, auth.sessionId, now);
    await audit(tx, auditContext(meta, { id: auth.userId, role: auth.role }), {
      action: 'auth.totp_enabled',
      entityType: 'user',
      entityId: auth.userId,
    });
  });
  return { recoveryCodes };
}

/** Spends an unused recovery code; false when the user does not hold it. */
async function consumeRecoveryCode(tx: Tx, userId: string, code: string, now: Date) {
  const hash = hashRecoveryCode(code);
  const spent = await tx
    .update(userTotp)
    .set({
      recoveryCodeHashes: sql`array_remove(${userTotp.recoveryCodeHashes}, ${hash}::text)`,
      updatedAt: now,
    })
    .where(
      and(eq(userTotp.userId, userId), sql`${hash}::text = any(${userTotp.recoveryCodeHashes})`),
    )
    .returning({ userId: userTotp.userId });
  return spent.length > 0;
}

/** Records the step of a valid code; false for a replay, even when two requests race. */
async function consumeTotpStep(tx: Tx, userId: string, step: number, now: Date): Promise<boolean> {
  const spent = await tx
    .update(userTotp)
    .set({ lastUsedStep: step, updatedAt: now })
    .where(
      and(
        eq(userTotp.userId, userId),
        or(isNull(userTotp.lastUsedStep), lt(userTotp.lastUsedStep, step)),
      ),
    )
    .returning({ userId: userTotp.userId });
  return spent.length > 0;
}

type TotpRow = typeof userTotp.$inferSelect;

/**
 * Spends a current TOTP code (replay-protected by step) or an unused recovery code inside `tx`;
 * false when the code is not accepted.
 */
async function spendCode(
  deps: AppDeps,
  tx: Tx,
  row: TotpRow,
  code: string,
  now: Date,
): Promise<boolean> {
  if (isRecoveryCode(code)) return consumeRecoveryCode(tx, row.userId, code, now);
  const verdict = verifyTotp(
    decryptSecret(row.secretCiphertext, deps.env.ENCRYPTION_KEY),
    code,
    row.lastUsedStep,
    now,
  );
  return verdict.ok && (await consumeTotpStep(tx, row.userId, verdict.step, now));
}

/** The caller's confirmed TOTP row; 409 CONFLICT when two-factor authentication is not active. */
async function confirmedTotpRow(deps: AppDeps, userId: string): Promise<TotpRow> {
  const [row] = await deps.db.select().from(userTotp).where(eq(userTotp.userId, userId));
  if (row === undefined || row.confirmedAt === null) throw conflict('CONFLICT', NOT_ACTIVE_MESSAGE);
  return row;
}

/**
 * Raises the session to MFA-verified with a current TOTP code or an unused recovery code
 * (FND-67..69).
 */
export async function verifyTotpCode(
  deps: AppDeps,
  auth: AuthContext,
  code: string,
): Promise<void> {
  const now = deps.now();
  await assertNotLocked(deps, auth.userId, now);
  const row = await confirmedTotpRow(deps, auth.userId);

  const accepted = await withTransaction(deps.db, async (tx) => {
    const ok = await spendCode(deps, tx, row, code, now);
    if (ok) await markSessionMfaVerified(tx, auth.sessionId, now);
    return ok;
  });
  if (!accepted) await rejectCode(deps, auth.userId, now);
}

/**
 * Turns two-factor authentication off (FND-136): only an MFA-verified session of an enrolled user,
 * with a current TOTP code or an unused recovery code (same rate limit and replay rules as
 * verify). Deletes the `user_totp` row with its recovery codes, clears the MFA mark of the user's
 * sessions and audits `user.totp_disabled`, in one transaction.
 */
export async function disableTotp(
  deps: AppDeps,
  auth: AuthContext,
  code: string,
  meta: RequestMeta,
): Promise<TotpDisableResponse> {
  const now = deps.now();
  if (!auth.totpConfirmed) throw conflict('CONFLICT', NOT_ACTIVE_MESSAGE);
  if (!auth.mfaVerified) {
    throw forbidden('MFA_REQUIRED', 'Confirme a verificação em duas etapas');
  }
  await assertNotLocked(deps, auth.userId, now);
  const row = await confirmedTotpRow(deps, auth.userId);

  const accepted = await withTransaction(deps.db, async (tx) => {
    if (!(await spendCode(deps, tx, row, code, now))) return false;
    await tx.delete(userTotp).where(eq(userTotp.userId, auth.userId));
    await tx.update(sessions).set({ mfaVerifiedAt: null }).where(eq(sessions.userId, auth.userId));
    await audit(tx, auditContext(meta, { id: auth.userId, role: auth.role }), {
      action: 'user.totp_disabled',
      entityType: 'user',
      entityId: auth.userId,
      before: { totpEnrolled: true },
      after: { totpEnrolled: false },
    });
    return true;
  });
  if (!accepted) await rejectCode(deps, auth.userId, now);
  return { mfa: { enrolled: false, verified: false } };
}
