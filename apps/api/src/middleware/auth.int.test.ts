import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createUser, loginAs } from '../../test/factories';
import { requireTestDatabaseUrl } from '../../test/require-test-db';
import { createApp } from '../app';
import { createDb } from '../db/client';
import { sessions, users } from '../db/schema';
import { requireRole } from './auth';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

beforeEach(() => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

function buildApp() {
  const app = createApp({ db });
  app.get('/app/ping', (c) => c.json({ ok: true, role: c.var.auth.role }));
  app.get('/admin/ping', (c) => c.json({ ok: true, role: c.var.auth.role }));
  app.get('/admin/admin-only', requireRole('admin'), (c) => c.json({ ok: true }));
  return app;
}

async function get(path: string, cookie?: string) {
  const response = await buildApp().request(path, {
    headers: cookie === undefined ? {} : { Cookie: cookie },
  });
  const body = (await response.json()) as { ok?: boolean; error?: { code: string } };
  return { status: response.status, code: body.error?.code, body };
}

describe('requireAuth on /app/* and /admin/* (FND-71)', () => {
  it('returns 401 UNAUTHENTICATED without a cookie on both prefixes', async () => {
    expect(await get('/app/ping')).toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
    expect(await get('/admin/ping')).toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
  });

  it('returns 401 UNAUTHENTICATED for a malformed session token', async () => {
    const result = await get('/app/ping', 'bravo_session=not-a-jwt');

    expect(result).toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
  });

  it('lets a tenant through on /app/*', async () => {
    const tenant = await createUser(db);

    const result = await get('/app/ping', await loginAs(db, tenant));

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true, role: 'tenant' });
  });

  it('returns 401 UNAUTHENTICATED for a revoked session (FND-56)', async () => {
    const tenant = await createUser(db);
    const cookie = await loginAs(db, tenant);
    await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.userId, tenant.id));

    expect(await get('/app/ping', cookie)).toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
  });
});

describe('requireStaff on /admin/* (FND-72, FND-63, FND-66)', () => {
  it('returns 403 FORBIDDEN for a tenant', async () => {
    const tenant = await createUser(db);

    const result = await get('/admin/ping', await loginAs(db, tenant));

    expect(result).toMatchObject({ status: 403, code: 'FORBIDDEN' });
  });

  it('returns 403 MFA_ENROLLMENT_REQUIRED for staff without a confirmed TOTP', async () => {
    const staff = await createUser(db, { role: 'reception' });

    const result = await get('/admin/ping', await loginAs(db, staff, { mfaVerified: true }));

    expect(result).toMatchObject({ status: 403, code: 'MFA_ENROLLMENT_REQUIRED' });
  });

  it('returns 403 MFA_ENROLLMENT_REQUIRED when the TOTP is enrolled but unconfirmed', async () => {
    const staff = await createUser(db, { role: 'admin', totp: 'unconfirmed' });

    const result = await get('/admin/ping', await loginAs(db, staff));

    expect(result).toMatchObject({ status: 403, code: 'MFA_ENROLLMENT_REQUIRED' });
  });

  it('returns 403 MFA_REQUIRED for staff with TOTP whose session is not MFA-verified', async () => {
    const staff = await createUser(db, { role: 'admin', totp: true });

    const result = await get('/admin/ping', await loginAs(db, staff, { mfaVerified: false }));

    expect(result).toMatchObject({ status: 403, code: 'MFA_REQUIRED' });
  });

  it('still lets unverified staff reach /app/* so the 2FA endpoints work', async () => {
    const staff = await createUser(db, { role: 'admin', totp: true });

    const result = await get('/app/ping', await loginAs(db, staff, { mfaVerified: false }));

    expect(result.status).toBe(200);
  });

  it('lets verified reception through /admin/ping', async () => {
    const staff = await createUser(db, { role: 'reception', totp: true });

    const result = await get('/admin/ping', await loginAs(db, staff, { mfaVerified: true }));

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true, role: 'reception' });
  });
});

describe('requireRole(admin) (FND-73)', () => {
  it('returns 403 FORBIDDEN for verified reception', async () => {
    const staff = await createUser(db, { role: 'reception', totp: true });

    const result = await get('/admin/admin-only', await loginAs(db, staff, { mfaVerified: true }));

    expect(result).toMatchObject({ status: 403, code: 'FORBIDDEN' });
  });

  it('returns 200 for a verified admin', async () => {
    const admin = await createUser(db, { role: 'admin', totp: true });

    const result = await get('/admin/admin-only', await loginAs(db, admin, { mfaVerified: true }));

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true });
  });
});

describe('role is read from the user row (FND-72 edge case)', () => {
  it('returns 403 on the next /admin/ping after the admin is demoted to tenant', async () => {
    const admin = await createUser(db, { role: 'admin', totp: true });
    const cookie = await loginAs(db, admin, { mfaVerified: true });
    expect((await get('/admin/ping', cookie)).status).toBe(200);

    await db.update(users).set({ role: 'tenant' }).where(eq(users.id, admin.id));

    expect(await get('/admin/ping', cookie)).toMatchObject({ status: 403, code: 'FORBIDDEN' });
  });
});
