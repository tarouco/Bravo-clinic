import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createUser, currentTotp, loginAs, totpFromUri } from '../../../../test/factories';
import { forbiddenFetch, send, sessionCookieFrom, testEnv } from '../../../../test/http';
import { requireTestDatabaseUrl } from '../../../../test/require-test-db';
import { createApp } from '../../../app';
import { createDb } from '../../../db/client';
import { auditLog, userTotp } from '../../../db/schema';
import { decryptSecret, sha256Hex } from '../../../lib/crypto';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

// Several requests per test against a remote database: the 5 s default is too tight.
vi.setConfig({ testTimeout: 60_000 });

beforeEach(() => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

// The app's clock is fixed so that TOTP steps cannot change between computing and checking a code.
const NOW = new Date();
const STEP_MS = 30_000;
const PASSWORD = 'senha1234';
const env = testEnv();

const app = () => createApp({ db, env, fetch: forbiddenFetch, now: () => NOW });
const call = (method: string, path: string, cookie: string, body?: unknown) =>
  send(app(), method, path, { cookie, ...(body !== undefined && { body }) });
const adminSession = (cookie: string) => call('GET', '/admin/session', cookie);

/** A 6-digit code that is not valid at NOW or one step either side. */
function wrongCode(secret: string): string {
  const valid = new Set(
    [-1, 0, 1].map((offset) => currentTotp(secret, new Date(NOW.getTime() + offset * STEP_MS))),
  );
  for (let n = 0; ; n++) {
    const candidate = String(n).padStart(6, '0');
    if (!valid.has(candidate)) return candidate;
  }
}

async function totpRowOf(userId: string) {
  const [row] = await db.select().from(userTotp).where(eq(userTotp.userId, userId));
  return row;
}

/** Enrolls and confirms through the API, as an authenticator app would. */
async function activateTotp(cookie: string) {
  const enrolled = await call('POST', '/app/auth/totp/enroll', cookie);
  const totp = totpFromUri((enrolled.body as { otpauthUri: string }).otpauthUri);
  const confirmed = await call('POST', '/app/auth/totp/confirm', cookie, {
    code: totp.generate({ timestamp: NOW.getTime() }),
  });
  return {
    secret: totp.secret.base32,
    recoveryCodes: (confirmed.body as { recoveryCodes: string[] }).recoveryCodes,
    confirmed,
  };
}

describe('POST /app/auth/totp/enroll (FND-64, FND-70)', () => {
  it('returns an otpauth URI for "Bravô Clinic" and stores only the encrypted, unconfirmed secret', async () => {
    const admin = await createUser(db, { role: 'admin', email: 'admin@exemplo.com' });
    const cookie = await loginAs(db, admin);

    const result = await call('POST', '/app/auth/totp/enroll', cookie);

    expect(result.status).toBe(200);
    const { otpauthUri } = result.body as { otpauthUri: string };
    expect(otpauthUri.startsWith('otpauth://totp/Brav%C3%B4%20Clinic:')).toBe(true);
    const totp = totpFromUri(otpauthUri);
    expect(totp.issuer).toBe('Bravô Clinic');
    expect(totp.label).toBe('admin@exemplo.com');
    expect(Object.keys(result.body as object)).toEqual(['otpauthUri']);

    const row = await totpRowOf(admin.id);
    expect(row?.confirmedAt).toBeNull();
    expect(row?.secretCiphertext).not.toContain(totp.secret.base32);
    expect(decryptSecret(row?.secretCiphertext ?? '', env.ENCRYPTION_KEY)).toBe(totp.secret.base32);

    // Enrolling again before confirming starts over with a new secret.
    const again = await call('POST', '/app/auth/totp/enroll', cookie);
    const secondTotp = totpFromUri((again.body as { otpauthUri: string }).otpauthUri);
    expect(secondTotp.secret.base32).not.toBe(totp.secret.base32);
    const replaced = await totpRowOf(admin.id);
    expect(decryptSecret(replaced?.secretCiphertext ?? '', env.ENCRYPTION_KEY)).toBe(
      secondTotp.secret.base32,
    );
  });

  it('refuses a tenant with 403 FORBIDDEN and stores nothing', async () => {
    const tenant = await createUser(db);

    const result = await call('POST', '/app/auth/totp/enroll', await loginAs(db, tenant));

    expect(result.status).toBe(403);
    expect(result.error?.code).toBe('FORBIDDEN');
    expect(await totpRowOf(tenant.id)).toBeUndefined();
  });

  it('refuses to replace a confirmed secret, so a password-only session cannot swap the factor (FND-66)', async () => {
    const reception = await createUser(db, { role: 'reception', totp: true });
    const before = await totpRowOf(reception.id);

    const result = await call('POST', '/app/auth/totp/enroll', await loginAs(db, reception));

    expect(result.status).toBe(409);
    expect(result.error?.code).toBe('CONFLICT');
    const after = await totpRowOf(reception.id);
    expect(after?.secretCiphertext).toBe(before?.secretCiphertext);
    expect(after?.confirmedAt).toEqual(before?.confirmedAt);
  });
});

describe('POST /app/auth/totp/confirm (FND-65, FND-70)', () => {
  it('confirms with the current code: ten recovery codes once, MFA-verified session, audit row', async () => {
    const admin = await createUser(db, { role: 'admin', email: 'admin@exemplo.com' });
    const cookie = await loginAs(db, admin);
    expect((await adminSession(cookie)).error?.code).toBe('MFA_ENROLLMENT_REQUIRED');

    const { secret, recoveryCodes, confirmed } = await activateTotp(cookie);

    expect(confirmed.status).toBe(200);
    expect(Object.keys(confirmed.body as object)).toEqual(['recoveryCodes']);
    expect(recoveryCodes).toHaveLength(10);
    expect(new Set(recoveryCodes).size).toBe(10);
    for (const code of recoveryCodes) expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);

    const row = await totpRowOf(admin.id);
    expect(row?.confirmedAt).toBeInstanceOf(Date);
    expect(row?.recoveryCodeHashes).toHaveLength(10);
    expect([...(row?.recoveryCodeHashes ?? [])].sort()).toEqual(
      recoveryCodes.map((code) => sha256Hex(code)).sort(),
    );
    expect(row?.recoveryCodeHashes.some((hash) => recoveryCodes.includes(hash))).toBe(false);

    expect((await adminSession(cookie)).status).toBe(200);
    const [entry] = await db.select().from(auditLog);
    expect(entry).toMatchObject({
      action: 'auth.totp_enabled',
      actorUserId: admin.id,
      actorRole: 'admin',
      origin: 'app',
      entityType: 'user',
      entityId: admin.id,
    });

    // The code that confirmed the enrollment is spent: a new session cannot reuse it.
    const replay = await call('POST', '/app/auth/totp/verify', await loginAs(db, admin), {
      code: currentTotp(secret, NOW),
    });
    expect(replay.status).toBe(401);
    expect(replay.error?.code).toBe('INVALID_CODE');
  });

  it('rejects a wrong code with 401 INVALID_CODE and keeps TOTP unconfirmed', async () => {
    const admin = await createUser(db, { role: 'admin' });
    const cookie = await loginAs(db, admin);
    const enrolled = await call('POST', '/app/auth/totp/enroll', cookie);
    const secret = totpFromUri((enrolled.body as { otpauthUri: string }).otpauthUri).secret.base32;

    const result = await call('POST', '/app/auth/totp/confirm', cookie, {
      code: wrongCode(secret),
    });

    expect(result.status).toBe(401);
    expect(result.error?.code).toBe('INVALID_CODE');
    expect((await totpRowOf(admin.id))?.confirmedAt).toBeNull();
    expect((await adminSession(cookie)).error?.code).toBe('MFA_ENROLLMENT_REQUIRED');
    expect(await db.select().from(auditLog)).toHaveLength(0);
  });
});

describe('POST /app/auth/totp/verify (FND-66, FND-67, FND-68)', () => {
  it('turns an MFA_REQUIRED session into a verified one after login with a valid code', async () => {
    const reception = await createUser(db, {
      role: 'reception',
      email: 'recepcao@exemplo.com',
      password: PASSWORD,
      totp: true,
    });
    const login = await send(app(), 'POST', '/public/auth/login', {
      body: { email: 'recepcao@exemplo.com', password: PASSWORD },
    });
    expect(login.body).toMatchObject({ mfaRequired: true });
    const cookie = sessionCookieFrom(login.headers) ?? '';
    const before = await adminSession(cookie);
    expect(before.status).toBe(403);
    expect(before.error?.code).toBe('MFA_REQUIRED');

    const result = await call('POST', '/app/auth/totp/verify', cookie, {
      code: currentTotp(reception.totpSecret ?? '', NOW),
    });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true });
    const after = await adminSession(cookie);
    expect(after.status).toBe(200);
    expect(after.body).toMatchObject({ role: 'reception' });
  });

  it('accepts a code with spaces and the neighbouring step, and rejects a spent step on a new session', async () => {
    const admin = await createUser(db, { role: 'admin', totp: true });
    const secret = admin.totpSecret ?? '';
    const code = currentTotp(secret, NOW);
    const first = await loginAs(db, admin);
    const second = await loginAs(db, admin);
    const third = await loginAs(db, admin);

    const spaced = await call('POST', '/app/auth/totp/verify', first, {
      code: `${code.slice(0, 3)} ${code.slice(3)}`,
    });
    const replay = await call('POST', '/app/auth/totp/verify', second, { code });
    const nextStep = await call('POST', '/app/auth/totp/verify', third, {
      code: currentTotp(secret, new Date(NOW.getTime() + STEP_MS)),
    });

    expect(spaced.status).toBe(200);
    expect(replay.status).toBe(401);
    expect(replay.error?.code).toBe('INVALID_CODE');
    expect((await adminSession(second)).error?.code).toBe('MFA_REQUIRED');
    expect(nextStep.status).toBe(200);
  });

  it('accepts each recovery code once, then removes it', async () => {
    const admin = await createUser(db, { role: 'admin' });
    const { recoveryCodes } = await activateTotp(await loginAs(db, admin));
    const [code, other] = recoveryCodes;
    const firstSession = await loginAs(db, admin);
    const secondSession = await loginAs(db, admin);

    const used = await call('POST', '/app/auth/totp/verify', firstSession, { code });
    const reused = await call('POST', '/app/auth/totp/verify', secondSession, { code });
    const another = await call('POST', '/app/auth/totp/verify', secondSession, { code: other });

    expect(used.status).toBe(200);
    expect((await adminSession(firstSession)).status).toBe(200);
    expect(reused.status).toBe(401);
    expect(reused.error?.code).toBe('INVALID_CODE');
    expect(another.status).toBe(200);
    const row = await totpRowOf(admin.id);
    expect(row?.recoveryCodeHashes).toHaveLength(8);
    expect(row?.recoveryCodeHashes).not.toContain(sha256Hex(code ?? ''));
  });

  it('refuses the sixth attempt with 429 after five invalid codes, even with a valid one', async () => {
    const admin = await createUser(db, { role: 'admin', totp: true });
    const secret = admin.totpSecret ?? '';
    const cookie = await loginAs(db, admin);

    for (let attempt = 1; attempt <= 5; attempt++) {
      const failed = await call('POST', '/app/auth/totp/verify', cookie, {
        code: wrongCode(secret),
      });
      expect(failed.status).toBe(401);
      expect(failed.error?.code).toBe('INVALID_CODE');
    }
    const locked = await call('POST', '/app/auth/totp/verify', cookie, {
      code: currentTotp(secret, NOW),
    });

    expect(locked.status).toBe(429);
    expect(locked.error?.code).toBe('TOO_MANY_ATTEMPTS');
    expect(Number(locked.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect((await adminSession(cookie)).error?.code).toBe('MFA_REQUIRED');
  });

  it('tells staff without a confirmed TOTP to enroll (403 MFA_ENROLLMENT_REQUIRED)', async () => {
    const admin = await createUser(db, { role: 'admin' });

    const result = await call('POST', '/app/auth/totp/verify', await loginAs(db, admin), {
      code: '123456',
    });

    expect(result.status).toBe(403);
    expect(result.error?.code).toBe('MFA_ENROLLMENT_REQUIRED');
  });
});
