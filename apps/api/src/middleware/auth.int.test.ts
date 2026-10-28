import { meSchema } from '@bravo/core';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createUser, currentTotp, loginAs } from '../../test/factories';
import { forbiddenFetch, send, testEnv } from '../../test/http';
import { requireTestDatabaseUrl } from '../../test/require-test-db';
import { createApp } from '../app';
import { createDb } from '../db/client';
import { sessions, users } from '../db/schema';
import { MFA_PENDING_ALLOWED, requireRole } from './auth';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

/** The `mfa` part of the session payload that `GET /app/me` returns. */
const sessionMfa = meSchema.pick({ mfa: true });

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

describe('requireStaff on /admin/* (FND-72, FND-63, FND-66, AD-037)', () => {
  it('returns 403 FORBIDDEN for a tenant', async () => {
    const tenant = await createUser(db);

    const result = await get('/admin/ping', await loginAs(db, tenant));

    expect(result).toMatchObject({ status: 403, code: 'FORBIDDEN' });
  });

  it('returns 403 FORBIDDEN for a tenant with TOTP even after the second factor', async () => {
    const tenant = await createUser(db, { totp: true });

    const result = await get('/admin/ping', await loginAs(db, tenant, { mfaVerified: true }));

    expect(result).toMatchObject({ status: 403, code: 'FORBIDDEN' });
  });

  it.each(['admin', 'reception'] as const)(
    'lets %s without TOTP through with a password-only session (2FA is optional)',
    async (role) => {
      const staff = await createUser(db, { role });

      const result = await get('/admin/ping', await loginAs(db, staff, { mfaVerified: false }));

      expect(result.status).toBe(200);
      expect(result.body).toEqual({ ok: true, role });
    },
  );

  it('treats an enrolled but unconfirmed TOTP as off: a password-only session passes', async () => {
    const staff = await createUser(db, { role: 'admin', totp: 'unconfirmed' });

    const result = await get('/admin/ping', await loginAs(db, staff));

    expect(result.status).toBe(200);
  });

  it('returns 403 MFA_REQUIRED for staff with TOTP whose session is not MFA-verified', async () => {
    const staff = await createUser(db, { role: 'admin', totp: true });

    const result = await get('/admin/ping', await loginAs(db, staff, { mfaVerified: false }));

    expect(result).toMatchObject({ status: 403, code: 'MFA_REQUIRED' });
  });

  it('lets verified reception through /admin/ping', async () => {
    const staff = await createUser(db, { role: 'reception', totp: true });

    const result = await get('/admin/ping', await loginAs(db, staff, { mfaVerified: true }));

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true, role: 'reception' });
  });
});

describe('requireMfaIfEnrolled on /app/* (FND-137, AD-037)', () => {
  const NOW = new Date();
  const env = testEnv();
  const app = () => {
    const built = createApp({ db, env, fetch: forbiddenFetch, now: () => NOW });
    built.get('/app/ping', (c) => c.json({ ok: true }));
    return built;
  };
  const call = (method: string, path: string, cookie: string, body?: unknown) =>
    send(app(), method, path, { cookie, ...(body !== undefined && { body }) });

  it('lists exactly the session query, the 2FA step and logout as allowed while MFA is pending', () => {
    expect([...MFA_PENDING_ALLOWED].sort()).toEqual(
      ['GET /app/me', 'POST /app/auth/logout', 'POST /app/auth/totp/verify'].sort(),
    );
  });

  it.each(['tenant', 'reception', 'admin'] as const)(
    'refuses everything else to a password-only session of an enrolled %s with 403 MFA_REQUIRED',
    async (role) => {
      const user = await createUser(db, { role, totp: true });
      const cookie = await loginAs(db, user, { now: NOW });

      for (const [method, path, body] of [
        ['GET', '/app/ping', undefined],
        ['GET', '/app/bookings?tab=upcoming', undefined],
        ['PATCH', '/app/me', { name: 'Outro Nome' }],
        ['POST', '/app/auth/totp/enroll', undefined],
        ['POST', '/app/auth/totp/disable', { code: '123456' }],
      ] as const) {
        const result = await call(method, path, cookie, body);
        expect([method, path, result.status, result.error?.code]).toEqual([
          method,
          path,
          403,
          'MFA_REQUIRED',
        ]);
      }
      const [row] = await db.select().from(users).where(eq(users.id, user.id));
      expect(row?.name).toBe(user.name);
    },
  );

  it.each(['tenant', 'reception', 'admin'] as const)(
    'lets a password-only session of an enrolled %s read /app/me, verify the code and log out',
    async (role) => {
      const user = await createUser(db, { role, totp: true });
      const cookie = await loginAs(db, user, { now: NOW });

      const me = await call('GET', '/app/me', cookie);
      expect(me.status).toBe(200);
      expect(sessionMfa.parse(me.body).mfa).toEqual({ enrolled: true, verified: false });

      const verified = await call('POST', '/app/auth/totp/verify', cookie, {
        code: currentTotp(user.totpSecret ?? '', NOW),
      });
      expect(verified.status).toBe(200);
      expect((await call('GET', '/app/ping', cookie)).status).toBe(200);

      const other = await loginAs(db, user, { now: NOW });
      expect((await call('POST', '/app/auth/logout', other)).status).toBe(204);
      expect((await call('GET', '/app/me', other)).status).toBe(401);
    },
  );

  it('lets users without a confirmed TOTP use /app/* with a password-only session', async () => {
    for (const totp of [false, 'unconfirmed'] as const) {
      const tenant = await createUser(db, { totp });
      const result = await call('GET', '/app/ping', await loginAs(db, tenant, { now: NOW }));
      expect(result.status).toBe(200);
    }
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
