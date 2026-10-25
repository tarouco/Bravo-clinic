import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createUser } from '../../../../test/factories';
import { forbiddenFetch, send, sessionCookieFrom, testEnv } from '../../../../test/http';
import { requireTestDatabaseUrl } from '../../../../test/require-test-db';
import { createApp } from '../../../app';
import { createDb } from '../../../db/client';
import { auditLog, sessions, users } from '../../../db/schema';
import { consumeRateLimit } from '../../../middleware/rate-limit';
import { LOGIN_IP_LIMIT, loginRateKey } from '../../../modules/auth/login.service';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

beforeEach(() => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

const PASSWORD = 'senha1234';

function buildApp(now?: () => Date) {
  return createApp({
    db,
    env: testEnv(),
    fetch: forbiddenFetch,
    ...(now !== undefined && { now }),
  });
}

async function login(
  body: { email: string; password: string },
  options: { now?: () => Date; headers?: Record<string, string> } = {},
) {
  return send(buildApp(options.now), 'POST', '/public/auth/login', {
    body,
    ...(options.headers !== undefined && { headers: options.headers }),
  });
}

function maxAgeOf(headers: Headers): string | undefined {
  const cookie = headers.getSetCookie().find((c) => c.startsWith('bravo_session='));
  return /Max-Age=(\d+)/.exec(cookie ?? '')?.[1];
}

describe('POST /public/auth/login: success (FND-52)', () => {
  it('logs a tenant in: 200, session row, 30-day cookie, same user shape as /app/me', async () => {
    const tenant = await createUser(db, { email: 'ana@exemplo.com', password: PASSWORD });

    const result = await login({ email: '  ANA@exemplo.com ', password: PASSWORD });

    expect(result.status).toBe(200);
    const body = result.body as { user: Record<string, unknown>; mfaRequired: boolean };
    expect(body.mfaRequired).toBe(false);
    expect(Object.keys(body.user).sort()).toEqual(
      ['docType', 'email', 'emailVerified', 'id', 'mfa', 'name', 'role'].sort(),
    );
    expect(body.user).toMatchObject({
      id: tenant.id,
      email: 'ana@exemplo.com',
      role: 'tenant',
      emailVerified: true,
      docType: null,
      mfa: { enrolled: false, verified: false },
    });
    expect(JSON.stringify(body)).not.toMatch(/password/i);

    const setCookie = result.headers.getSetCookie().find((c) => c.startsWith('bravo_session='));
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Path=/');
    expect(maxAgeOf(result.headers)).toBe('2592000');
    const rows = await db.select().from(sessions);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: tenant.id, mfaVerifiedAt: null, revokedAt: null });
    const [stored] = await db.select().from(users).where(eq(users.id, tenant.id));
    expect(stored?.lastLoginAt).toBeInstanceOf(Date);
    expect(await db.select().from(auditLog)).toHaveLength(0);

    const cookie = sessionCookieFrom(result.headers);
    const me = await send(buildApp(), 'GET', '/app/me', { cookie: cookie ?? '' });
    expect(me.status).toBe(200);
  });
});

describe('POST /public/auth/login: wrong credentials (FND-53)', () => {
  it('answers a wrong password and an unknown e-mail with the same 401 and message', async () => {
    await createUser(db, { email: 'ana@exemplo.com', password: PASSWORD });

    const wrongPassword = await login({ email: 'ana@exemplo.com', password: 'errada9999' });
    const unknownEmail = await login({ email: 'ninguem@exemplo.com', password: PASSWORD });

    for (const result of [wrongPassword, unknownEmail]) {
      expect(result.status).toBe(401);
      expect(result.error?.code).toBe('INVALID_CREDENTIALS');
      expect(result.error?.message).toBe('E-mail ou senha incorretos');
      expect(result.headers.getSetCookie()).toEqual([]);
    }
    expect(await db.select().from(sessions)).toHaveLength(0);
  });

  it('refuses a disabled account with the same 401', async () => {
    const user = await createUser(db, { email: 'ana@exemplo.com', password: PASSWORD });
    await db.update(users).set({ status: 'disabled' }).where(eq(users.id, user.id));

    const result = await login({ email: 'ana@exemplo.com', password: PASSWORD });

    expect(result.status).toBe(401);
    expect(result.error?.code).toBe('INVALID_CREDENTIALS');
    expect(await db.select().from(sessions)).toHaveLength(0);
  });
});

describe('POST /public/auth/login: lockout (FND-54)', () => {
  it('refuses the 6th attempt with 429 and Retry-After even with the right password', async () => {
    await createUser(db, { email: 'ana@exemplo.com', password: PASSWORD });

    for (let attempt = 1; attempt <= 5; attempt++) {
      const failed = await login({ email: 'ana@exemplo.com', password: 'errada9999' });
      expect(failed.status).toBe(401);
    }
    const locked = await login({ email: 'ana@exemplo.com', password: PASSWORD });

    expect(locked.status).toBe(429);
    expect(locked.error?.code).toBe('TOO_MANY_ATTEMPTS');
    const retryAfter = Number(locked.headers.get('Retry-After'));
    expect(Number.isInteger(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(900);
    expect(await db.select().from(sessions)).toHaveLength(0);

    // The window is 15 minutes: after it, the right password works again.
    const later = await login(
      { email: 'ana@exemplo.com', password: PASSWORD },
      { now: () => new Date(Date.now() + 901_000) },
    );
    expect(later.status).toBe(200);
  }, 90_000);

  it('locks an IP out after 30 failures while other IPs still log in', async () => {
    await createUser(db, { email: 'ana@exemplo.com', password: PASSWORD });
    await Promise.all(
      Array.from({ length: LOGIN_IP_LIMIT.limit }, () =>
        consumeRateLimit(db, loginRateKey.ip('203.0.113.9'), LOGIN_IP_LIMIT),
      ),
    );

    const blocked = await login(
      { email: 'ana@exemplo.com', password: PASSWORD },
      { headers: { 'X-Forwarded-For': '203.0.113.9' } },
    );
    const other = await login(
      { email: 'ana@exemplo.com', password: PASSWORD },
      { headers: { 'X-Forwarded-For': '203.0.113.10' } },
    );

    expect(blocked.status).toBe(429);
    expect(blocked.error?.code).toBe('TOO_MANY_ATTEMPTS');
    expect(Number(blocked.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(other.status).toBe(200);
  }, 60_000);
});

describe('POST /public/auth/login: staff (FND-58, FND-66)', () => {
  it('asks for the second factor when TOTP is confirmed, with an unverified 12-hour session and an audit row', async () => {
    const staff = await createUser(db, {
      role: 'reception',
      email: 'recepcao@exemplo.com',
      password: PASSWORD,
      totp: true,
    });

    const result = await login(
      { email: 'recepcao@exemplo.com', password: PASSWORD },
      { headers: { 'X-Forwarded-For': '203.0.113.5' } },
    );

    expect(result.status).toBe(200);
    const body = result.body as { user: { mfa: unknown; role: string }; mfaRequired: boolean };
    expect(body.mfaRequired).toBe(true);
    expect(body.user).toMatchObject({
      role: 'reception',
      mfa: { enrolled: true, verified: false },
    });
    expect(maxAgeOf(result.headers)).toBe('43200');
    const [session] = await db.select().from(sessions);
    expect(session).toMatchObject({ userId: staff.id, mfaVerifiedAt: null });
    const [entry] = await db.select().from(auditLog);
    expect(entry).toMatchObject({
      action: 'auth.login_staff',
      actorUserId: staff.id,
      actorRole: 'reception',
      origin: 'web',
      entityType: 'user',
      entityId: staff.id,
      ip: '203.0.113.5',
    });
  });

  it('does not ask for a second factor before TOTP is confirmed, but still audits the staff login', async () => {
    const admin = await createUser(db, {
      role: 'admin',
      email: 'admin@exemplo.com',
      password: PASSWORD,
    });

    const result = await login({ email: 'admin@exemplo.com', password: PASSWORD });

    expect(result.status).toBe(200);
    const body = result.body as { user: { mfa: unknown }; mfaRequired: boolean };
    expect(body.mfaRequired).toBe(false);
    expect(body.user.mfa).toEqual({ enrolled: false, verified: false });
    const entries = await db.select().from(auditLog);
    expect(entries.map((e) => [e.action, e.actorUserId])).toEqual([['auth.login_staff', admin.id]]);
  });
});
