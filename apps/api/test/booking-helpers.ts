import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Db } from '../src/db/client';
import { rooms, users } from '../src/db/schema';
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

/** A tenant with a CPF (unless `document: false`) and a session cookie. */
export async function createTenant(
  db: Db,
  options: CreateUserOptions & { document?: boolean; now?: Date } = {},
) {
  counter += 1;
  const n = counter;
  const { document, now, ...userOptions } = options;
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
  const cookie = await loginAs(db, user, now === undefined ? {} : { now });
  return { user, cookie };
}

/** The seeded room with the given slug (default: Sala Principal). */
export async function seededRoom(db: Db, slug = 'principal') {
  const [room] = await db.select().from(rooms).where(eq(rooms.slug, slug));
  if (room === undefined) throw new Error(`seed created no room ${slug}`);
  return room;
}
