import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createUser, loginAs } from '../../../test/factories';
import { forbiddenFetch, send, testEnv } from '../../../test/http';
import { requireTestDatabaseUrl } from '../../../test/require-test-db';
import { createApp } from '../../app';
import { createDb } from '../../db/client';
import { sessions, users } from '../../db/schema';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

beforeEach(() => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

const app = () => createApp({ db, env: testEnv(), fetch: forbiddenFetch });

describe('GET /app/me (FND-57)', () => {
  it('returns exactly id, name, email, role, emailVerified, docType and mfa for a tenant', async () => {
    const tenant = await createUser(db, { name: 'Ana Souza', email: 'ana@exemplo.com' });

    const result = await send(app(), 'GET', '/app/me', { cookie: await loginAs(db, tenant) });

    expect(result.status).toBe(200);
    expect(Object.keys(result.body as object).sort()).toEqual(
      ['docType', 'email', 'emailVerified', 'id', 'mfa', 'name', 'role'].sort(),
    );
    expect(result.body).toEqual({
      id: tenant.id,
      name: 'Ana Souza',
      email: 'ana@exemplo.com',
      role: 'tenant',
      emailVerified: true,
      docType: null,
      mfa: { enrolled: false, verified: false },
    });
  });

  it('reflects an unverified e-mail, the document type and the MFA state of the session', async () => {
    const staff = await createUser(db, { role: 'admin', verified: false, totp: true });
    await db
      .update(users)
      .set({ docType: 'cpf', docNumber: '52998224725' })
      .where(eq(users.id, staff.id));

    const result = await send(app(), 'GET', '/app/me', {
      cookie: await loginAs(db, staff, { mfaVerified: true }),
    });

    expect(result.body).toMatchObject({
      role: 'admin',
      emailVerified: false,
      docType: 'cpf',
      mfa: { enrolled: true, verified: true },
    });
    expect(JSON.stringify(result.body)).not.toMatch(/password|secret|52998224725/i);
  });
});

describe('POST /app/auth/logout (FND-55)', () => {
  it('revokes the session, clears the cookie with Max-Age=0 and returns 204', async () => {
    const tenant = await createUser(db);
    const cookie = await loginAs(db, tenant);
    const otherCookie = await loginAs(db, tenant);

    const result = await send(app(), 'POST', '/app/auth/logout', { cookie });

    expect(result.status).toBe(204);
    expect(result.body).toBeNull();
    const cleared = result.headers.getSetCookie().find((c) => c.startsWith('bravo_session='));
    expect(cleared).toContain('Max-Age=0');
    const rows = await db.select().from(sessions);
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.revokedAt !== null)).toHaveLength(1);

    const reused = await send(app(), 'GET', '/app/me', { cookie });
    expect(reused.status).toBe(401);
    expect(reused.error?.code).toBe('UNAUTHENTICATED');
    // Only the session that logged out is revoked.
    expect((await send(app(), 'GET', '/app/me', { cookie: otherCookie })).status).toBe(200);
  });
});
