import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Db } from '../src/db/client';
import { charges, rooms, users } from '../src/db/schema';
import { createUser, loginAs, type CreateUserOptions } from './factories';

/** A valid CPF (11 digits) derived from `seed`; different seeds give different numbers. */
export function cpf(seed: number): string {
  const digits = Array.from(String(100_000_000 + seed * 7919).slice(0, 9), Number);
  const check = (count: number) => {
    const sum = digits
      .slice(0, count)
      .reduce((total, digit, index) => total + digit * (count + 1 - index), 0);
    return ((sum * 10) % 11) % 10;
  };
  digits.push(check(9));
  digits.push(check(10));
  return digits.join('');
}

let counter = 0;

/**
 * A tenant with a CPF (unless `document: false`) and a session cookie. A tenant created with
 * `totp: true` needs `mfaVerified: true` to use `/app/*` beyond the 2FA step (AD-037).
 */
export async function createTenant(
  db: Db,
  options: CreateUserOptions & { document?: boolean; now?: Date; mfaVerified?: boolean } = {},
) {
  counter += 1;
  const n = counter;
  const { document, now, mfaVerified, ...userOptions } = options;
  const user = await createUser(db, {
    email: `tenant-${String(n)}-${randomUUID().slice(0, 6)}@bravoclinic.test`,
    name: `Locatário ${String(n)}`,
    ...userOptions,
  });
  if (document !== false) {
    await db
      .update(users)
      .set({ docType: 'cpf', docNumber: cpf(n) })
      .where(eq(users.id, user.id));
  }
  const cookie = await loginAs(db, user, {
    ...(now !== undefined && { now }),
    ...(mfaVerified !== undefined && { mfaVerified }),
  });
  return { user, cookie };
}

/** An admin or reception user with confirmed TOTP and an MFA-verified session cookie. */
export async function createStaff(db: Db, role: 'admin' | 'reception' = 'admin', now?: Date) {
  const user = await createUser(db, { role, totp: true, name: `Equipe ${role}` });
  const cookie = await loginAs(db, user, { mfaVerified: true, ...(now !== undefined && { now }) });
  return { user, cookie };
}

/** Inserts a charge of a booking; `approved` by default, with an external id the sandbox can refund. */
export async function createCharge(
  db: Db,
  input: {
    userId: string;
    bookingId: string | null;
    purpose: string;
    amountCents: number;
    status?: string;
    method?: string;
    approvedAt?: Date | null;
    externalId?: string | null;
    expiresAt?: Date | null;
    createdAt?: Date;
  },
) {
  const status = input.status ?? 'approved';
  const [charge] = await db
    .insert(charges)
    .values({
      provider: 'sandbox',
      externalId: input.externalId === undefined ? `sbx_${randomUUID()}` : input.externalId,
      purpose: input.purpose,
      method: input.method ?? 'pix',
      userId: input.userId,
      bookingId: input.bookingId,
      amountCents: input.amountCents,
      status,
      approvedAt: status === 'approved' ? (input.approvedAt ?? new Date()) : null,
      expiresAt: input.expiresAt ?? null,
      idempotencyKey: `ch_${randomUUID()}`,
      ...(input.createdAt !== undefined && { createdAt: input.createdAt }),
    })
    .returning();
  if (charge === undefined) throw new Error('createCharge: insert returned no row');
  return charge;
}

/** The seeded room with the given slug (default: Sala Principal). */
export async function seededRoom(db: Db, slug = 'principal') {
  const [room] = await db.select().from(rooms).where(eq(rooms.slug, slug));
  if (room === undefined) throw new Error(`seed created no room ${slug}`);
  return room;
}
