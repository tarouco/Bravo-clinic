import { randomBytes, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { SESSION_COOKIE, issueSession } from '../src/auth/session';
import { withTransaction, type Db } from '../src/db/client';
import { userTotp, users } from '../src/db/schema';
import { getEnv } from '../src/env';
import { encryptSecret, hashPassword } from '../src/lib/crypto';

export interface CreateUserOptions {
  role?: 'tenant' | 'reception' | 'admin';
  email?: string;
  name?: string;
  verified?: boolean;
  /** When set the user gets a scrypt hash of this password. */
  password?: string;
  /** `true`: confirmed TOTP; `'unconfirmed'`: enrolled but not confirmed. Secret is returned as `totpSecret`. */
  totp?: boolean | 'unconfirmed';
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function randomBase32Secret(): string {
  return Array.from(randomBytes(20), (byte) => BASE32[byte % 32]).join('');
}

/** Inserts a user row directly, optionally with a password hash and a TOTP enrollment. */
export async function createUser(db: Db, options: CreateUserOptions = {}) {
  const [row] = await db
    .insert(users)
    .values({
      role: options.role ?? 'tenant',
      name: options.name ?? 'Test User',
      email: options.email ?? `user-${randomUUID()}@bravoclinic.test`,
      emailVerifiedAt: options.verified === false ? null : sql`now()`,
      passwordHash: options.password === undefined ? null : await hashPassword(options.password),
    })
    .returning();
  if (row === undefined) throw new Error('createUser: insert returned no row');

  let totpSecret: string | undefined;
  if (options.totp !== undefined && options.totp !== false) {
    totpSecret = randomBase32Secret();
    await db.insert(userTotp).values({
      userId: row.id,
      secretCiphertext: encryptSecret(totpSecret, getEnv().ENCRYPTION_KEY),
      confirmedAt: options.totp === true ? sql`now()` : null,
    });
  }
  return { ...row, totpSecret };
}

/** Opens a session for the user and returns the `Cookie` request header value. */
export async function loginAs(
  db: Db,
  user: { id: string; role: string },
  opts: { mfaVerified?: boolean; now?: Date } = {},
): Promise<string> {
  const { token } = await withTransaction(db, (tx) =>
    issueSession(
      tx,
      getEnv().SESSION_SECRET,
      { id: user.id, role: user.role as 'tenant' | 'reception' | 'admin' },
      { mfaVerified: opts.mfaVerified ?? false, ...(opts.now !== undefined && { now: opts.now }) },
    ),
  );
  return `${SESSION_COOKIE}=${token}`;
}

/** Filled by the TOTP task (T35): needs the totp library. */
export function currentTotp(): never {
  throw new Error('currentTotp is not available until the TOTP library exists (T35)');
}
