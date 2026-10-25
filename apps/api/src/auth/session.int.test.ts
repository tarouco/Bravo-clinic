import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { afterAll, describe, expect, it } from 'vitest';
import { createUser } from '../../test/factories';
import { requireTestDatabaseUrl } from '../../test/require-test-db';
import { createDb, withTransaction } from '../db/client';
import { sessions } from '../db/schema';
import {
  clearSessionCookie,
  issueSession,
  markSessionMfaVerified,
  resolveSession,
  revokeAllSessions,
  revokeSession,
  setSessionCookie,
} from './session';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));
const SECRET = 'test-only-session-secret-0123456789abcdef';
const OTHER_SECRET = 'another-secret-that-is-long-enough-0123456789';

afterAll(async () => {
  await pool.end();
});

function issue(
  user: { id: string; role: 'tenant' | 'reception' | 'admin' },
  mfaVerified = false,
  now?: Date,
) {
  return withTransaction(db, (tx) =>
    issueSession(tx, SECRET, user, { mfaVerified, ...(now !== undefined && { now }) }),
  );
}

async function signRaw(
  claims: { sid: string; sub: string; role: string; iat: number; exp: number },
  secret: string,
) {
  return new SignJWT({ sid: claims.sid, role: claims.role, mfa: false })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt(claims.iat)
    .setExpirationTime(claims.exp)
    .sign(new TextEncoder().encode(secret));
}

async function cookieHeaderFor(maxAgeSeconds: number): Promise<string> {
  const app = new Hono();
  app.get('/set', (c) => {
    setSessionCookie(c, 'token-value', maxAgeSeconds);
    return c.body(null, 204);
  });
  const response = await app.request('/set');
  return response.headers.get('Set-Cookie') ?? '';
}

describe('session cookie (FND-52, FND-58)', () => {
  it('sets bravo_session with HttpOnly, Secure, SameSite=Lax, Path=/ and the tenant Max-Age', async () => {
    const user = await createUser(db, { role: 'tenant' });
    const { maxAgeSeconds } = await issue({ id: user.id, role: 'tenant' });

    const header = await cookieHeaderFor(maxAgeSeconds);

    expect(header).toContain('bravo_session=token-value');
    expect(header).toContain('HttpOnly');
    expect(header).toContain('Secure');
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain('Path=/');
    expect(header).toContain('Max-Age=2592000');
  });

  it('gives staff Max-Age 43200 and expires_at about 12 hours ahead', async () => {
    const admin = await createUser(db, { role: 'admin' });
    const before = Date.now();

    const { maxAgeSeconds, sessionId } = await issue({ id: admin.id, role: 'admin' });

    expect(await cookieHeaderFor(maxAgeSeconds)).toContain('Max-Age=43200');
    const [row] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
    const expected = before + 12 * 3600 * 1000;
    expect(Math.abs((row?.expiresAt.getTime() ?? 0) - expected)).toBeLessThan(60_000);
  });

  it('clears the cookie with Max-Age=0', async () => {
    const app = new Hono();
    app.get('/clear', (c) => {
      clearSessionCookie(c);
      return c.body(null, 204);
    });

    const header = (await app.request('/clear')).headers.get('Set-Cookie') ?? '';

    expect(header).toContain('bravo_session=');
    expect(header).toContain('Max-Age=0');
  });
});

describe('resolveSession (FND-56)', () => {
  it('resolves a valid token to the auth context read from the database', async () => {
    const user = await createUser(db, { role: 'reception', totp: true });
    const { token, sessionId } = await issue({ id: user.id, role: 'reception' }, true);

    expect(await resolveSession(db, token, SECRET)).toEqual({
      userId: user.id,
      role: 'reception',
      sessionId,
      mfaVerified: true,
      totpConfirmed: true,
    });
  });

  it('returns null for a token signed with another secret', async () => {
    const user = await createUser(db);
    const { sessionId } = await issue({ id: user.id, role: 'tenant' });
    const iat = Math.floor(Date.now() / 1000);
    const forged = await signRaw(
      { sid: sessionId, sub: user.id, role: 'tenant', iat, exp: iat + 3600 },
      OTHER_SECRET,
    );

    expect(await resolveSession(db, forged, SECRET)).toBeNull();
  });

  it('returns null when the JWT exp has passed even if the session row is still live', async () => {
    const user = await createUser(db);
    const { sessionId } = await issue({ id: user.id, role: 'tenant' });
    const iat = Math.floor(Date.now() / 1000) - 7200;
    const expired = await signRaw(
      { sid: sessionId, sub: user.id, role: 'tenant', iat, exp: iat + 3600 },
      SECRET,
    );

    expect(await resolveSession(db, expired, SECRET)).toBeNull();
  });

  it('returns null for a revoked session row', async () => {
    const user = await createUser(db);
    const { token, sessionId } = await issue({ id: user.id, role: 'tenant' });
    await withTransaction(db, (tx) => revokeSession(tx, sessionId));

    expect(await resolveSession(db, token, SECRET)).toBeNull();
  });

  it('returns null when the session row is past expires_at', async () => {
    const user = await createUser(db);
    const { token, sessionId } = await issue({ id: user.id, role: 'tenant' });
    await db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(sessions.id, sessionId));

    expect(await resolveSession(db, token, SECRET)).toBeNull();
  });

  it('returns null for a string that is not a JWT', async () => {
    expect(await resolveSession(db, 'garbage', SECRET)).toBeNull();
  });
});

describe('session state changes', () => {
  it('revokeAllSessions revokes every active session of that user only', async () => {
    const victim = await createUser(db);
    const bystander = await createUser(db);
    const first = await issue({ id: victim.id, role: 'tenant' });
    const second = await issue({ id: victim.id, role: 'tenant' });
    const other = await issue({ id: bystander.id, role: 'tenant' });

    await withTransaction(db, (tx) => revokeAllSessions(tx, victim.id));

    expect(await resolveSession(db, first.token, SECRET)).toBeNull();
    expect(await resolveSession(db, second.token, SECRET)).toBeNull();
    expect(await resolveSession(db, other.token, SECRET)).not.toBeNull();
    const rows = await db.select().from(sessions).where(eq(sessions.userId, victim.id));
    expect(rows.every((row) => row.revokedAt !== null)).toBe(true);
  });

  it('markSessionMfaVerified flips mfaVerified on the next resolve', async () => {
    const staff = await createUser(db, { role: 'admin', totp: true });
    const { token, sessionId } = await issue({ id: staff.id, role: 'admin' }, false);
    expect((await resolveSession(db, token, SECRET))?.mfaVerified).toBe(false);

    await withTransaction(db, (tx) => markSessionMfaVerified(tx, sessionId));

    expect((await resolveSession(db, token, SECRET))?.mfaVerified).toBe(true);
  });
});
