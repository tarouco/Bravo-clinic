import { randomInt } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Tx } from '../../db/client';
import { authTokens } from '../../db/schema';
import { randomToken, sha256Hex } from '../../lib/crypto';

export type AuthTokenPurpose = 'email_verify' | 'password_reset';

/** Lifetime of each purpose: 24 hours to verify an e-mail, 60 minutes to reset a password. */
const TTL_SECONDS: Record<AuthTokenPurpose, number> = {
  email_verify: 86_400,
  password_reset: 3_600,
};

/**
 * Stores the sha256 of a fresh random token and returns the raw token (it only ever travels by
 * e-mail). `ttlSeconds` overrides the lifetime of the purpose, e.g. the 72 h "create your
 * password" link of an account made at the counter.
 */
export async function createAuthToken(
  tx: Tx,
  input: { userId: string; purpose: AuthTokenPurpose; now: Date; ttlSeconds?: number },
): Promise<string> {
  const token = randomToken();
  await tx.insert(authTokens).values({
    userId: input.userId,
    purpose: input.purpose,
    tokenHash: sha256Hex(token),
    expiresAt: new Date(
      input.now.getTime() + (input.ttlSeconds ?? TTL_SECONDS[input.purpose]) * 1000,
    ),
  });
  return token;
}

/**
 * Marks the token used and returns its user id; null when it is unknown, already used or expired.
 * One guarded UPDATE, so a token is single-use even when two requests race.
 */
export async function consumeAuthToken(
  tx: Tx,
  input: { token: string; purpose: AuthTokenPurpose; now: Date },
): Promise<string | null> {
  const [row] = await tx
    .update(authTokens)
    .set({ usedAt: input.now })
    .where(
      and(
        eq(authTokens.tokenHash, sha256Hex(input.token)),
        eq(authTokens.purpose, input.purpose),
        isNull(authTokens.usedAt),
        gt(authTokens.expiresAt, input.now),
      ),
    )
    .returning({ userId: authTokens.userId });
  return row?.userId ?? null;
}

/** An e-mailed two-factor code is valid for 10 minutes (AD-047). */
export const MFA_EMAIL_CODE_TTL_SECONDS = 600;

/**
 * Six digits have only a million values and `token_hash` is unique across users, so the stored
 * hash covers the user id too: equal codes of two users never collide and never match each other.
 */
const mfaEmailCodeHash = (userId: string, code: string) => sha256Hex(`mfa_email:${userId}:${code}`);

/**
 * Stores the hash of a fresh 6-digit code and returns the code (it only ever travels by e-mail).
 * Codes sent earlier and not yet used stop working, so only the newest e-mail is valid.
 */
export async function createMfaEmailCode(
  tx: Tx,
  input: { userId: string; now: Date },
): Promise<string> {
  await tx
    .update(authTokens)
    .set({ usedAt: input.now })
    .where(
      and(
        eq(authTokens.userId, input.userId),
        eq(authTokens.purpose, 'mfa_email'),
        isNull(authTokens.usedAt),
      ),
    );
  const code = String(randomInt(1_000_000)).padStart(6, '0');
  await tx.insert(authTokens).values({
    userId: input.userId,
    purpose: 'mfa_email',
    tokenHash: mfaEmailCodeHash(input.userId, code),
    expiresAt: new Date(input.now.getTime() + MFA_EMAIL_CODE_TTL_SECONDS * 1000),
  });
  return code;
}

/** Spends the user's e-mailed code; false when it is wrong, already used or expired. */
export async function consumeMfaEmailCode(
  tx: Tx,
  input: { userId: string; code: string; now: Date },
): Promise<boolean> {
  const spent = await tx
    .update(authTokens)
    .set({ usedAt: input.now })
    .where(
      and(
        eq(authTokens.userId, input.userId),
        eq(authTokens.tokenHash, mfaEmailCodeHash(input.userId, input.code)),
        eq(authTokens.purpose, 'mfa_email'),
        isNull(authTokens.usedAt),
        gt(authTokens.expiresAt, input.now),
      ),
    )
    .returning({ id: authTokens.id });
  return spent.length > 0;
}
