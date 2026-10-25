import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Db } from '../src/db/client';
import { users } from '../src/db/schema';

export interface CreateUserOptions {
  role?: 'tenant' | 'reception' | 'admin';
  email?: string;
  name?: string;
  verified?: boolean;
}

/** Inserts a user row directly. Password, TOTP and session options arrive with the tasks that need them. */
export async function createUser(db: Db, options: CreateUserOptions = {}) {
  const [row] = await db
    .insert(users)
    .values({
      role: options.role ?? 'tenant',
      name: options.name ?? 'Test User',
      email: options.email ?? `user-${randomUUID()}@bravoclinic.test`,
      emailVerifiedAt: options.verified === false ? null : sql`now()`,
    })
    .returning();
  if (row === undefined) throw new Error('createUser: insert returned no row');
  return row;
}

/** Filled by the session service task (T27/T32): needs issueSession and the cookie format. */
export function loginAs(): never {
  throw new Error('loginAs is not available until the session service exists (T27)');
}

/** Filled by the TOTP task (T35): needs the totp library. */
export function currentTotp(): never {
  throw new Error('currentTotp is not available until the TOTP library exists (T35)');
}
