import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createUser, loginAs } from '../../../../test/factories';
import { forbiddenFetch, send, testEnv, tokenFromEmail } from '../../../../test/http';
import { requireTestDatabaseUrl } from '../../../../test/require-test-db';
import { createApp } from '../../../app';
import { createDb } from '../../../db/client';
import { auditLog, authTokens, emailOutbox, sessions, users } from '../../../db/schema';
import { sha256Hex } from '../../../lib/crypto';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

beforeEach(() => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

const MINUTE_MS = 60_000;
const OLD_PASSWORD = 'senha1234';
const NEW_PASSWORD = 'novaSenha99';

function buildApp(now?: () => Date) {
  return createApp({
    db,
    env: testEnv(),
    fetch: forbiddenFetch,
    ...(now !== undefined && { now }),
  });
}

function requestReset(email: string) {
  return send(buildApp(), 'POST', '/public/auth/password-reset/request', { body: { email } });
}

function confirmReset(token: string, password: string, now?: () => Date) {
  return send(buildApp(now), 'POST', '/public/auth/password-reset/confirm', {
    body: { token, password },
  });
}

function login(email: string, password: string) {
  return send(buildApp(), 'POST', '/public/auth/login', { body: { email, password } });
}

async function passwordHashOf(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ hash: users.passwordHash })
    .from(users)
    .where(eq(users.id, userId));
  return row?.hash ?? null;
}

/** A user with a known password who asked for a reset; returns the token from the e-mailed link. */
async function userWithResetToken() {
  const user = await createUser(db, { email: 'ana@exemplo.com', password: OLD_PASSWORD });
  expect((await requestReset('ana@exemplo.com')).status).toBe(202);
  const [outbox] = await db.select().from(emailOutbox);
  return { user, token: tokenFromEmail(outbox?.html ?? '') };
}

describe('POST /public/auth/password-reset/request (FND-60)', () => {
  it('answers 202 and queues nothing for an unknown e-mail', async () => {
    const result = await requestReset('ninguem@exemplo.com');

    expect(result.status).toBe(202);
    expect(await db.select().from(emailOutbox)).toHaveLength(0);
    expect(await db.select().from(authTokens)).toHaveLength(0);
  });

  it('answers 202 and queues one auth.password_reset e-mail with a 60-minute hashed token', async () => {
    const user = await createUser(db, { email: 'ana@exemplo.com', password: OLD_PASSWORD });

    const result = await requestReset('  ANA@exemplo.com ');

    expect(result.status).toBe(202);
    const outbox = await db.select().from(emailOutbox);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({
      toAddress: 'ana@exemplo.com',
      template: 'auth.password_reset',
      subject: 'Redefina sua senha na Bravô Clinic',
    });
    const token = tokenFromEmail(outbox[0]?.html ?? '');
    expect(outbox[0]?.html).toContain(`/redefinir-senha?token=${token}`);
    const [row] = await db.select().from(authTokens);
    expect(row).toMatchObject({
      userId: user.id,
      purpose: 'password_reset',
      tokenHash: sha256Hex(token),
      usedAt: null,
    });
    const lifetimeMs = (row?.expiresAt.getTime() ?? 0) - Date.now();
    expect(lifetimeMs).toBeGreaterThan(59 * MINUTE_MS);
    expect(lifetimeMs).toBeLessThanOrEqual(60 * MINUTE_MS);
  });

  it('answers 202 but sends nothing for a disabled user', async () => {
    const user = await createUser(db, { email: 'ana@exemplo.com', password: OLD_PASSWORD });
    await db.update(users).set({ status: 'disabled' }).where(eq(users.id, user.id));

    const result = await requestReset('ana@exemplo.com');

    expect(result.status).toBe(202);
    expect(await db.select().from(emailOutbox)).toHaveLength(0);
  });

  it('silently caps a sixth request within an hour: still 202, no sixth e-mail', async () => {
    await createUser(db, { email: 'ana@exemplo.com', password: OLD_PASSWORD });

    for (let call = 1; call <= 6; call++) {
      expect((await requestReset('ana@exemplo.com')).status).toBe(202);
    }

    expect(await db.select().from(emailOutbox)).toHaveLength(5);
  }, 90_000);
});

describe('POST /public/auth/password-reset/confirm (FND-61)', () => {
  it('replaces the password, revokes every session, spends the token and audits it', async () => {
    const { user, token } = await userWithResetToken();
    const olderCookie = await loginAs(db, user);
    await loginAs(db, user);

    const result = await confirmReset(token, NEW_PASSWORD);

    expect(result.status).toBe(200);
    expect(await login('ana@exemplo.com', NEW_PASSWORD)).toMatchObject({ status: 200 });
    expect((await login('ana@exemplo.com', OLD_PASSWORD)).status).toBe(401);
    const me = await send(buildApp(), 'GET', '/app/me', { cookie: olderCookie });
    expect(me.status).toBe(401);
    expect(me.error?.code).toBe('UNAUTHENTICATED');
    const sessionRows = await db.select().from(sessions);
    // The two older sessions are revoked; the one opened by the login above is the only live one.
    expect(sessionRows.filter((row) => row.revokedAt === null)).toHaveLength(1);
    const [tokenRow] = await db.select().from(authTokens);
    expect(tokenRow?.usedAt).toBeInstanceOf(Date);
    const [entry] = await db.select().from(auditLog);
    expect(entry).toMatchObject({
      action: 'auth.password_reset',
      actorUserId: user.id,
      actorRole: 'tenant',
      origin: 'web',
      entityType: 'user',
      entityId: user.id,
    });
    expect(JSON.stringify(entry)).not.toContain(NEW_PASSWORD);
  }, 60_000);
});

describe('POST /public/auth/password-reset/confirm: invalid input (FND-61, FND-62)', () => {
  it('rejects a reused token with 400 INVALID_TOKEN and keeps the new password', async () => {
    const { user, token } = await userWithResetToken();
    expect((await confirmReset(token, NEW_PASSWORD)).status).toBe(200);
    const hashAfterFirst = await passwordHashOf(user.id);

    const again = await confirmReset(token, 'outraSenha77');

    expect(again.status).toBe(400);
    expect(again.error?.code).toBe('INVALID_TOKEN');
    expect(await passwordHashOf(user.id)).toBe(hashAfterFirst);
  });

  it('rejects an unknown token with 400 INVALID_TOKEN and changes nothing', async () => {
    const { user } = await userWithResetToken();
    const before = await passwordHashOf(user.id);

    const result = await confirmReset('desconhecido', NEW_PASSWORD);

    expect(result.status).toBe(400);
    expect(result.error?.code).toBe('INVALID_TOKEN');
    expect(await passwordHashOf(user.id)).toBe(before);
    expect(await db.select().from(auditLog)).toHaveLength(0);
  });

  it('rejects a token older than 60 minutes but accepts one just inside the window', async () => {
    const { user, token } = await userWithResetToken();
    const before = await passwordHashOf(user.id);

    const late = await confirmReset(
      token,
      NEW_PASSWORD,
      () => new Date(Date.now() + 61 * MINUTE_MS),
    );
    expect(late.status).toBe(400);
    expect(late.error?.code).toBe('INVALID_TOKEN');
    expect(await passwordHashOf(user.id)).toBe(before);

    const inside = await confirmReset(
      token,
      NEW_PASSWORD,
      () => new Date(Date.now() + 59 * MINUTE_MS),
    );
    expect(inside.status).toBe(200);
    expect(await passwordHashOf(user.id)).not.toBe(before);
  });

  it('rejects a password that breaks the policy with 422 and leaves the token usable', async () => {
    const { user, token } = await userWithResetToken();
    const before = await passwordHashOf(user.id);

    const weak = await confirmReset(token, 'abc');

    expect(weak.status).toBe(422);
    expect(weak.error?.code).toBe('VALIDATION_FAILED');
    expect(weak.error?.details?.map((d) => d.path)).toContain('password');
    expect(await passwordHashOf(user.id)).toBe(before);
    expect((await confirmReset(token, NEW_PASSWORD)).status).toBe(200);
  });
});
