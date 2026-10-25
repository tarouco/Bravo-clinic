import { settingKeys } from '@bravo/core';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createUser } from '../../test/factories';
import { requireTestDatabaseUrl } from '../../test/require-test-db';
import { createDb } from './client';
import { auditLog, businessHours, holidays, rooms, settings, users } from './schema';
import { runSeed } from './seed';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

const bootstrap = { email: 'Admin@Bravo.test', password: 'Senha1234', name: 'Administrador geral' };

describe('seed defaults (FND-20, FND-37, FND-38, FND-39)', () => {
  it('inserts one settings row per catalog key with the factory default', async () => {
    const report = await runSeed(db);

    const rows = await db.select().from(settings);
    expect(rows).toHaveLength(settingKeys.length);
    expect(report.settingsInserted).toBe(settingKeys.length);
    expect(rows.find((row) => row.key === 'payment.deposit_percent')?.value).toBe(50);
  });

  it('inserts the 3 rooms with slug, name, tags, active status and display order', async () => {
    await runSeed(db);

    const rows = await db.select().from(rooms).orderBy(rooms.displayOrder);
    expect(rows.map((r) => [r.slug, r.name, r.idealFor, r.status, r.displayOrder])).toEqual([
      ['principal', 'Sala Principal', ['Médico', 'Estética', 'Gravação de vídeos'], 'active', 1],
      ['secundaria', 'Sala Secundária', ['Médico', 'Estética', 'Gravação de vídeos'], 'active', 2],
      ['terceira', 'Sala Terceira', ['Massagem', 'Terapia', 'Estética'], 'active', 3],
    ]);
  });

  it('inserts 8 open business-hours rows: mon-fri 420-1440, sat/sun/holiday 540-1440', async () => {
    await runSeed(db);

    const rows = await db.select().from(businessHours);
    const byDay = Object.fromEntries(
      rows.map((r) => [r.dayType, [r.openMinute, r.closeMinute, r.isClosed]]),
    );
    expect(byDay).toEqual({
      mon: [420, 1440, false],
      tue: [420, 1440, false],
      wed: [420, 1440, false],
      thu: [420, 1440, false],
      fri: [420, 1440, false],
      sat: [540, 1440, false],
      sun: [540, 1440, false],
      holiday: [540, 1440, false],
    });
  });

  it('inserts 28 holidays, none closed, only 2027-08-15 needing review', async () => {
    await runSeed(db);

    const rows = await db.select().from(holidays);
    const scopes = (scope: string) => rows.filter((r) => r.scope === scope).length;
    expect(rows).toHaveLength(28);
    expect(rows.every((r) => !r.isClosed && r.source === 'seed')).toBe(true);
    expect(scopes('national')).toBe(20);
    expect(scopes('state') + scopes('municipal')).toBe(8);
    expect(rows.filter((r) => r.needsReview).map((r) => r.date)).toEqual(['2027-08-15']);
  });
});

describe('seed idempotency (FND-40)', () => {
  it('adds no duplicates on a second run and keeps edited settings and rooms', async () => {
    await runSeed(db);
    await db.update(settings).set({ value: 30 }).where(eq(settings.key, 'payment.deposit_percent'));
    await db.update(rooms).set({ name: 'Sala Renomeada' }).where(eq(rooms.slug, 'principal'));

    const report = await runSeed(db);

    expect(report).toEqual({
      settingsInserted: 0,
      roomsInserted: 0,
      holidaysInserted: 0,
      businessHoursInserted: 0,
      adminCreated: false,
    });
    const counts = [
      (await db.select().from(settings)).length,
      (await db.select().from(rooms)).length,
      (await db.select().from(holidays)).length,
      (await db.select().from(businessHours)).length,
    ];
    expect(counts).toEqual([settingKeys.length, 3, 28, 8]);
    const deposit = await db
      .select()
      .from(settings)
      .where(eq(settings.key, 'payment.deposit_percent'));
    const principal = await db.select().from(rooms).where(eq(rooms.slug, 'principal'));
    expect(deposit[0]?.value).toBe(30);
    expect(principal[0]?.name).toBe('Sala Renomeada');
  });
});

describe('admin bootstrap (FND-41, FND-42)', () => {
  it('creates one verified admin with a scrypt hash and audits user.bootstrap_admin', async () => {
    const report = await runSeed(db, { adminBootstrap: bootstrap });

    const admins = await db.select().from(users).where(eq(users.role, 'admin'));
    expect(report.adminCreated).toBe(true);
    expect(admins).toHaveLength(1);
    expect(admins[0]?.email).toBe('admin@bravo.test');
    expect(admins[0]?.emailVerifiedAt).toBeInstanceOf(Date);
    expect(admins[0]?.passwordHash).toMatch(/^scrypt\$16384\$8\$1\$/);
    const audit = await db.select().from(auditLog);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: 'user.bootstrap_admin',
      origin: 'system',
      entityType: 'user',
      entityId: admins[0]?.id,
    });
  });

  it('creates no second admin when rerun with a different bootstrap e-mail', async () => {
    await runSeed(db, { adminBootstrap: bootstrap });

    const report = await runSeed(db, {
      adminBootstrap: { ...bootstrap, email: 'outro@bravo.test' },
    });

    const admins = await db.select().from(users).where(eq(users.role, 'admin'));
    expect(report.adminCreated).toBe(false);
    expect(admins.map((a) => a.email)).toEqual(['admin@bravo.test']);
  });

  it('leaves an existing admin unmodified and creates no account', async () => {
    const existing = await createUser(db, { role: 'admin', name: 'Admin Existente' });

    const report = await runSeed(db, { adminBootstrap: bootstrap });

    const rows = await db.select().from(users);
    expect(report.adminCreated).toBe(false);
    expect(rows).toEqual([existing]);
  });

  it('fails with the password policy message and creates nothing for password "abc"', async () => {
    await expect(
      runSeed(db, { adminBootstrap: { ...bootstrap, password: 'abc' } }),
    ).rejects.toThrow('ADMIN_BOOTSTRAP_PASSWORD does not meet the password policy');

    expect(await db.select().from(users)).toHaveLength(0);
    expect(await db.select().from(settings)).toHaveLength(0);
  });
});
