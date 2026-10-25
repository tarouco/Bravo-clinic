import { isStaff } from '@bravo/core';
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
import { userTotp, users } from '../../db/schema';
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

function assertStaff(auth: AuthContext): void {
  if (!isStaff(auth.role)) throw forbidden();
}

async function assertNotLocked(deps: AppDeps, userId: string, now: Date): Promise<void> {
  const gate = await peekRateLimit(deps.db, failureKey(userId), { ...TOTP_FAILURE_LIMIT, now });
  if (!gate.allowed) throw tooManyRequests(gate.retryAfterSeconds);
}

/** Counts one invalid code (on the pool, so it survives the request) and answers 401. */
async function rejectCode(deps: AppDeps, userId: string, now: Date): Promise<never> {
  await consumeRateLimit(deps.db, failureKey(userId), { ...TOTP_FAILURE_LIMIT, now });
  throw unauthorized('INVALID_CODE', INVALID_CODE_MESSAGE);
}

/** Stores a fresh encrypted, unconfirmed secret and returns the URI for the QR code (FND-64). */
export async function enrollTotp(
  deps: AppDeps,
  auth: AuthContext,
): Promise<{ otpauthUri: string }> {
  assertStaff(auth);
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
  assertStaff(auth);
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

/**
 * Raises the session to MFA-verified with a current TOTP code or an unused recovery code
 * (FND-67..69).
 */
export async function verifyTotpCode(
  deps: AppDeps,
  auth: AuthContext,
  code: string,
): Promise<void> {
  const { db, env } = deps;
  const now = deps.now();
  await assertNotLocked(deps, auth.userId, now);

  const [row] = await db.select().from(userTotp).where(eq(userTotp.userId, auth.userId));
  if (row === undefined || row.confirmedAt === null) {
    throw isStaff(auth.role)
      ? forbidden('MFA_ENROLLMENT_REQUIRED', 'Cadastre a verificação em duas etapas')
      : forbidden();
  }

  const accepted = await withTransaction(db, async (tx) => {
    let ok: boolean;
    if (isRecoveryCode(code)) {
      ok = await consumeRecoveryCode(tx, auth.userId, code, now);
    } else {
      const verdict = verifyTotp(
        decryptSecret(row.secretCiphertext, env.ENCRYPTION_KEY),
        code,
        row.lastUsedStep,
        now,
      );
      ok = verdict.ok && (await consumeTotpStep(tx, auth.userId, verdict.step, now));
    }
    if (ok) await markSessionMfaVerified(tx, auth.sessionId, now);
    return ok;
  });
  if (!accepted) await rejectCode(deps, auth.userId, now);
}
