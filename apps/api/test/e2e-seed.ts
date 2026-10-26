// End-to-end harness for the Playwright suite (nucleo T49). Run as a script it resets
// DATABASE_URL_TEST (Neon `dev`, never production), migrates and seeds it, and serves the API on
// :8787 for the Vite dev proxy. Imported by the specs it gives the fixed accounts and the outbox
// and booking lookups. Every password and the TOTP secret below are test-only values.
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  addDays,
  localToUtc,
  policySnapshot,
  settingDefaults,
  utcToLocal,
  type LocalDate,
} from '@bravo/core';
import * as OTPAuth from 'otpauth';
import { Pool } from 'pg';
import { assertNotProduction } from './require-test-db';

const rootEnvFile = fileURLToPath(new URL('../../../.env', import.meta.url));
export const E2E_API_PORT = 8787;
export const E2E_WEB_URL = 'http://localhost:5173';

export const E2E_ADMIN = {
  email: 'admin.e2e@bravoclinic.test',
  password: 'AdminE2e2026',
  name: 'Admin E2E',
  totpSecret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
};

/** One verified tenant per Playwright project, each with a paid booking to reschedule and cancel. */
export const E2E_TENANTS = {
  desktop: { email: 'locataria.desktop@bravoclinic.test', name: 'Ana Desktop' },
  mobile: { email: 'locataria.mobile@bravoclinic.test', name: 'Bia Mobile' },
} as const;
export const E2E_TENANT_PASSWORD = 'Locataria2026';

/** Customers the admin books for (pre-reservation scenario). */
export const E2E_CUSTOMERS = {
  desktop: { email: 'cliente.desktop@bravoclinic.test', name: 'Carla Balcão' },
  mobile: { email: 'cliente.mobile@bravoclinic.test', name: 'Dora Balcão' },
} as const;

export type E2eProject = keyof typeof E2E_TENANTS;

/** Number of bookings seeded in the measured month (spec Success Criteria). */
export const LOAD_BOOKINGS = 500;

/** Reads the root `.env` once and returns the test database URL, refusing production targets. */
let checkedUrl: string | undefined;
export function e2eDatabaseUrl(): string {
  // Checked once: the seed then points DATABASE_URL at the test database for the API it serves.
  if (checkedUrl !== undefined) return checkedUrl;
  if (existsSync(rootEnvFile)) process.loadEnvFile(rootEnvFile);
  const url = process.env.DATABASE_URL_TEST;
  if (url === undefined || url === '') throw new Error('DATABASE_URL_TEST is required for e2e');
  assertNotProduction(url, {
    urls: [process.env.DATABASE_URL, process.env.DATABASE_URL_UNPOOLED],
    branchId: process.env.NEON_BRANCH_PRODUCTION,
  });
  checkedUrl = url;
  return url;
}

/** The code the admin's authenticator shows now. */
export function adminTotp(now = new Date()): string {
  return new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(E2E_ADMIN.totpSecret),
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
  }).generate({ timestamp: now.getTime() });
}

let lookupPool: Pool | undefined;
function pool(): Pool {
  lookupPool ??= new Pool({ connectionString: e2eDatabaseUrl(), max: 2 });
  return lookupPool;
}

export async function closeE2eDb(): Promise<void> {
  await lookupPool?.end();
  lookupPool = undefined;
}

/** Newest outbox row of a template for an address (the API has no Resend key under e2e). */
export async function latestEmail(
  to: string,
  template: string,
): Promise<{ html: string; attachments: unknown } | null> {
  const { rows } = await pool().query<{ html: string; attachments: unknown }>(
    `select html, attachments from email_outbox where to_address = $1 and template = $2
      order by created_at desc limit 1`,
    [to, template],
  );
  return rows[0] ?? null;
}

export async function bookingByCode(code: string) {
  const { rows } = await pool().query<{
    id: string;
    status: string;
    checked_in_at: Date | null;
    confirmed_manually_by: string | null;
  }>(`select id, status, checked_in_at, confirmed_manually_by from bookings where code = $1`, [
    code,
  ]);
  return rows[0] ?? null;
}

/**
 * The `nth` date (São Paulo, 0-based) at least `minDays` after today whose weekday (0 = Sunday)
 * is in `weekdays` and that is not a seeded holiday, so weekday prices apply (W-PR).
 */
export async function bookableWeekday(
  weekdays: readonly number[],
  minDays: number,
  nth = 0,
  now = new Date(),
): Promise<LocalDate> {
  const { rows } = await pool().query<{ date: string }>(`select date::text as date from holidays`);
  const holidays = new Set(rows.map((r) => r.date));
  let date = addDays(utcToLocal(now).date, minDays);
  for (let found = 0; ; date = addDays(date, 1)) {
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (!weekdays.includes(weekday) || holidays.has(date)) continue;
    if (found === nth) return date;
    found += 1;
  }
}

const WORKDAYS = [1, 2, 3, 4, 5] as const;

/** Day of the tenant booking each project reschedules and cancels (14:00-16:00, ≥ 4 days ahead). */
export function tenantBookingDate(project: E2eProject): Promise<LocalDate> {
  return bookableWeekday(WORKDAYS, 4, project === 'desktop' ? 0 : 1);
}

/** First day of the month two months ahead: inside the 90-day horizon, away from the flows. */
export function loadMonth(now = new Date()): string {
  const local = utcToLocal(now).date;
  const [year, month] = local.split('-').map(Number) as [number, number];
  const index = year * 12 + (month - 1) + 2;
  return `${String(Math.floor(index / 12))}-${String((index % 12) + 1).padStart(2, '0')}`;
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const bookingCode = () => `BRV-${Array.from(randomBytes(6), (b) => BASE32[b % 32]).join('')}`;

/** A valid CPF derived from `seed` (same algorithm as the integration helpers). */
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

/** Empties every table of schema `public` (same as the integration harness, without vitest). */
async function truncateAll(target: Pool): Promise<void> {
  const { rows } = await target.query<{ tablename: string }>(
    `select tablename from pg_tables where schemaname = 'public'`,
  );
  if (rows.length === 0) return;
  const names = rows.map((row) => `"${row.tablename.replaceAll('"', '""')}"`).join(', ');
  await target.query(`truncate table ${names} restart identity cascade`);
}

async function seed(): Promise<void> {
  const url = e2eDatabaseUrl();
  // The API under test sees only the test database.
  process.env.DATABASE_URL = url;
  delete process.env.DATABASE_URL_UNPOOLED;
  delete process.env.NEON_BRANCH;
  process.env.APP_BASE_URL = E2E_WEB_URL;
  process.env.NODE_ENV = 'development';
  delete process.env.RESEND_API_KEY;

  const { runMigrations } = await import('../src/db/migrate');
  const { createDb } = await import('../src/db/client');
  const { runSeed } = await import('../src/db/seed');
  const { encryptSecret, hashPassword } = await import('../src/lib/crypto');
  const schema = await import('../src/db/schema');

  await runMigrations(url);
  const { pool: seedPool, db } = createDb(url);
  try {
    await truncateAll(seedPool);
    await runSeed(db);
    // Open around the clock so the check-in scenario (start within the next hour) always has a slot.
    await db
      .update(schema.businessHours)
      .set({ isClosed: false, openMinute: 0, closeMinute: 1440 });
    await db
      .insert(schema.settings)
      .values({ key: 'onboarding.prices_reviewed', value: true })
      .onConflictDoUpdate({ target: schema.settings.key, set: { value: true } });

    const [admin] = await db
      .insert(schema.users)
      .values({
        role: 'admin',
        name: E2E_ADMIN.name,
        email: E2E_ADMIN.email,
        emailVerifiedAt: new Date(),
        passwordHash: await hashPassword(E2E_ADMIN.password),
      })
      .returning();
    if (admin === undefined) throw new Error('admin insert returned no row');
    await db.insert(schema.userTotp).values({
      userId: admin.id,
      secretCiphertext: encryptSecret(E2E_ADMIN.totpSecret, process.env.ENCRYPTION_KEY ?? ''),
      confirmedAt: new Date(),
    });

    const rooms = await db.select().from(schema.rooms);
    const roomBySlug = new Map(rooms.map((r) => [r.slug, r]));
    const terceira = roomBySlug.get('terceira');
    const principal = roomBySlug.get('principal');
    if (terceira === undefined || principal === undefined) throw new Error('seeded rooms missing');

    let n = 1;
    const tenantPassword = await hashPassword(E2E_TENANT_PASSWORD);
    const snapshot = policySnapshot(settingDefaults());
    for (const project of Object.keys(E2E_TENANTS) as E2eProject[]) {
      const tenant = E2E_TENANTS[project];
      const [user] = await db
        .insert(schema.users)
        .values({
          role: 'tenant',
          name: tenant.name,
          email: tenant.email,
          emailVerifiedAt: new Date(),
          passwordHash: tenantPassword,
          docType: 'cpf',
          docNumber: cpf(n++),
          phone: '+5511999990001',
        })
        .returning();
      if (user === undefined) throw new Error('tenant insert returned no row');
      // CA-1 shape: 2 h on a weekday (16000), fully paid, sinal 8000, in Sala Terceira.
      const date = await tenantBookingDate(project);
      const startsAt = localToUtc(date, 840);
      const endsAt = localToUtc(date, 960);
      const [booking] = await db
        .insert(schema.bookings)
        .values({
          code: bookingCode(),
          userId: user.id,
          roomId: terceira.id,
          kind: 'single',
          status: 'paid',
          source: 'web',
          startsAt,
          endsAt,
          cleanupMinutes: 30,
          durationMinutes: 120,
          paymentMode: 'deposit_balance',
          grossCents: 16000,
          totalCents: 16000,
          depositCents: 8000,
          paidCents: 16000,
          balanceCents: 0,
          policySnapshot: snapshot,
          icsUid: `${randomUUID()}@bravoclinic.test`,
        })
        .returning();
      if (booking === undefined) throw new Error('booking insert returned no row');
      await db.insert(schema.bookingSegments).values({
        bookingId: booking.id,
        seq: 1,
        startsAt,
        endsAt,
        categoryName: '2 horas ou mais',
        dayType: 'weekday',
        rateCentsPerHour: 8000,
        minutes: 120,
        amountCents: 16000,
      });
      await db.insert(schema.roomOccupancy).values({
        roomId: terceira.id,
        period: `[${startsAt.toISOString()},${new Date(endsAt.getTime() + 30 * 60_000).toISOString()})`,
        kind: 'booking',
        refId: booking.id,
      });
      await db.insert(schema.charges).values({
        provider: 'sandbox',
        externalId: `sbx_${randomUUID()}`,
        purpose: 'booking_deposit',
        method: 'pix',
        userId: user.id,
        bookingId: booking.id,
        amountCents: 16000,
        status: 'approved',
        approvedAt: new Date(),
        idempotencyKey: `ch_${randomUUID()}`,
      });

      const customer = E2E_CUSTOMERS[project];
      await db.insert(schema.users).values({
        role: 'tenant',
        name: customer.name,
        email: customer.email,
        emailVerifiedAt: new Date(),
        docType: 'cpf',
        docNumber: cpf(n++),
        phone: '+5511999990002',
      });
    }

    await seedLoad(db, schema, principal.id, url);
    process.stdout.write('e2e seed ready\n');
  } finally {
    await seedPool.end();
  }
}

/** 500 confirmed 60-min bookings in the load month, every 90 min (cleanup 30) from 00:00. */
async function seedLoad(
  db: Awaited<ReturnType<(typeof import('../src/db/client'))['createDb']>>['db'],
  schema: typeof import('../src/db/schema'),
  roomId: string,
  url: string,
): Promise<void> {
  const [{ id: userId } = { id: '' }] = await db
    .insert(schema.users)
    .values({ role: 'tenant', name: 'Carga E2E', email: 'carga.e2e@bravoclinic.test' })
    .returning({ id: schema.users.id });
  const first = `${loadMonth()}-01` as LocalDate;
  const snapshot = policySnapshot(settingDefaults());
  const rows: (typeof schema.bookings.$inferInsert)[] = [];
  for (let day = 0; rows.length < LOAD_BOOKINGS; day++) {
    const date = addDays(first, day);
    for (let minute = 0; minute + 60 <= 1440 && rows.length < LOAD_BOOKINGS; minute += 90) {
      rows.push({
        code: bookingCode(),
        userId,
        roomId,
        kind: 'single',
        status: 'confirmed',
        source: 'admin',
        startsAt: localToUtc(date, minute),
        endsAt: localToUtc(date, minute + 60),
        cleanupMinutes: 30,
        durationMinutes: 60,
        paymentMode: 'manual',
        grossCents: 9700,
        totalCents: 9700,
        depositCents: 0,
        paidCents: 0,
        balanceCents: 9700,
        policySnapshot: snapshot,
        icsUid: `${randomUUID()}@bravoclinic.test`,
      });
    }
  }
  const inserted = await db.insert(schema.bookings).values(rows).returning({
    id: schema.bookings.id,
    startsAt: schema.bookings.startsAt,
    endsAt: schema.bookings.endsAt,
  });
  await db.insert(schema.bookingSegments).values(
    inserted.map((b) => ({
      bookingId: b.id,
      seq: 1,
      startsAt: b.startsAt,
      endsAt: b.endsAt,
      categoryName: '1 hora',
      dayType: 'weekday',
      rateCentsPerHour: 9700,
      minutes: 60,
      amountCents: 9700,
    })),
  );
  await db.insert(schema.roomOccupancy).values(
    inserted.map((b) => ({
      roomId,
      period: `[${b.startsAt.toISOString()},${new Date(b.endsAt.getTime() + 30 * 60_000).toISOString()})`,
      kind: 'booking',
      refId: b.id,
    })),
  );
  // Fresh statistics so the planner uses the period index right away.
  const analyze = new Pool({ connectionString: url, max: 1 });
  try {
    await analyze.query('analyze bookings; analyze room_occupancy;');
  } finally {
    await analyze.end();
  }
}

async function serve(): Promise<void> {
  const { serve: listen } = await import('@hono/node-server');
  const { createApp } = await import('../src/app');
  const { drizzle } = await import('drizzle-orm/node-postgres');
  // This host is one ~130 ms round trip away from the Neon dev branch (production runs next to
  // it), so the harness pool fits one request's parallel queries (8 for a day grid) in one round.
  const app = createApp({
    db: drizzle(
      new Pool({ connectionString: process.env.DATABASE_URL, max: 10, idleTimeoutMillis: 120_000 }),
    ),
  });
  const server = listen({ fetch: app.fetch, port: E2E_API_PORT }, () => {
    process.stdout.write(`e2e api listening on http://localhost:${String(E2E_API_PORT)}\n`);
  });
  // Outlive the Vite proxy's idle keep-alive sockets, so a reused socket is never closed under it.
  if ('keepAliveTimeout' in server) server.keepAliveTimeout = 120_000;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await seed();
  await serve();
}
