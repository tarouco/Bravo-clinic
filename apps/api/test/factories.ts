import { randomBytes, randomUUID } from 'node:crypto';
import { policySnapshot, settingDefaults } from '@bravo/core';
import { sql } from 'drizzle-orm';
import * as OTPAuth from 'otpauth';
import { SESSION_COOKIE, issueSession } from '../src/auth/session';
import { withTransaction, type Db } from '../src/db/client';
import {
  bookingCategories,
  bookings,
  bookingSegments,
  roomOccupancy,
  userTotp,
  users,
} from '../src/db/schema';
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

/** The 6-digit code an authenticator app shows for the base32 `secret` at `now`. */
export function currentTotp(secret: string, now: Date = new Date()): string {
  return new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(secret),
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
  }).generate({ timestamp: now.getTime() });
}

/** Parses an `otpauth://` enrollment URI the way an authenticator app does. */
export function totpFromUri(uri: string): OTPAuth.TOTP {
  const parsed = OTPAuth.URI.parse(uri);
  if (!(parsed instanceof OTPAuth.TOTP)) throw new Error('not a TOTP URI');
  return parsed;
}

type CategoryRow = typeof bookingCategories.$inferSelect;
type CategoryOverrides = Partial<typeof bookingCategories.$inferInsert>;

/** Inserts an active hourly category ("Hora teste", 60 min from 00:00 to 24:00) unless overridden. */
export async function createCategory(
  db: Db,
  overrides: CategoryOverrides = {},
): Promise<CategoryRow> {
  const type = overrides.type ?? 'hourly';
  const base: CategoryOverrides =
    type === 'hourly'
      ? { weekdayRateCents: 9000, weekendRateCents: 11000, minDurationMinutes: 60 }
      : type === 'block'
        ? { fixedPriceCents: 28000 }
        : {};
  const [row] = await db
    .insert(bookingCategories)
    .values({
      name: `Categoria ${randomUUID().slice(0, 8)}`,
      type,
      period: 'single',
      ...base,
      ...overrides,
    })
    .returning();
  if (row === undefined) throw new Error('createCategory: insert returned no row');
  return row;
}

const BOOKING_CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const ACTIVE_STATUSES: readonly string[] = [
  'awaiting_payment',
  'pre_reserved',
  'held_for_renewal',
  'confirmed',
  'paid',
];

export interface CreateBookingOptions {
  userId: string;
  roomId: string;
  startsAt: Date;
  endsAt: Date;
  status?: string;
  kind?: 'single' | 'fixed_occurrence';
  cleanupMinutes?: number;
  totalCents?: number;
  paidCents?: number;
  depositCents?: number;
  paymentMode?: string;
  holdExpiresAt?: Date | null;
  balanceChargeAt?: Date | null;
  balanceDueAt?: Date | null;
  source?: 'web' | 'app' | 'admin' | 'mcp';
  cleanupOverridden?: boolean;
  /** Skip the occupancy row (inactive bookings never have an active one). */
  occupancy?: boolean;
}

/**
 * Inserts a booking with one frozen segment and, for active statuses, its occupancy
 * `[start, end + cleanup)`. Defaults: `confirmed`, cleanup 30, deposit/full paid.
 */
export async function createBooking(db: Db, options: CreateBookingOptions) {
  const status = options.status ?? 'confirmed';
  const cleanupMinutes = options.cleanupMinutes ?? 30;
  const minutes = Math.round((options.endsAt.getTime() - options.startsAt.getTime()) / 60_000);
  const total = options.totalCents ?? 9700;
  const code = `BRV-${Array.from(randomBytes(6), (b) => BOOKING_CODE_ALPHABET[b % 32]).join('')}`;
  const [row] = await db
    .insert(bookings)
    .values({
      code,
      userId: options.userId,
      roomId: options.roomId,
      kind: options.kind ?? 'single',
      status,
      source: options.source ?? 'web',
      startsAt: options.startsAt,
      endsAt: options.endsAt,
      cleanupMinutes,
      durationMinutes: minutes,
      paymentMode: options.paymentMode ?? 'deposit_balance',
      grossCents: total,
      totalCents: total,
      depositCents: options.depositCents ?? Math.ceil(total / 2),
      balanceCents: total - (options.paidCents ?? Math.ceil(total / 2)),
      paidCents: options.paidCents ?? Math.ceil(total / 2),
      holdExpiresAt: options.holdExpiresAt ?? null,
      balanceChargeAt: options.balanceChargeAt ?? null,
      balanceDueAt: options.balanceDueAt ?? null,
      policySnapshot: policySnapshot(settingDefaults()),
      icsUid: `${randomUUID()}@bravoclinic.test`,
      cleanupOverriddenAt: options.cleanupOverridden === true ? new Date() : null,
    })
    .returning();
  if (row === undefined) throw new Error('createBooking: insert returned no row');
  await db.insert(bookingSegments).values({
    bookingId: row.id,
    seq: 1,
    startsAt: options.startsAt,
    endsAt: options.endsAt,
    categoryName: 'Hora teste',
    dayType: 'weekday',
    rateCentsPerHour: Math.round((total * 60) / minutes),
    minutes,
    amountCents: total,
  });
  if (options.occupancy !== false && ACTIVE_STATUSES.includes(status)) {
    const until = new Date(options.endsAt.getTime() + cleanupMinutes * 60_000);
    await db.insert(roomOccupancy).values({
      roomId: options.roomId,
      period: `[${options.startsAt.toISOString()},${until.toISOString()})`,
      kind: 'booking',
      refId: row.id,
    });
  }
  return row;
}
