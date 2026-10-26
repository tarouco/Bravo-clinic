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
