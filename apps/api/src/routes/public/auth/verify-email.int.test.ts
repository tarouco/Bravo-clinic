import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createUser, loginAs } from '../../../../test/factories';
import {
  forbiddenFetch,
  send,
  sessionCookieFrom,
  testEnv,
  tokenFromEmail,
} from '../../../../test/http';
import { requireTestDatabaseUrl } from '../../../../test/require-test-db';
import { createApp } from '../../../app';
import { createDb } from '../../../db/client';
import { authTokens, emailOutbox, users } from '../../../db/schema';
import { sha256Hex } from '../../../lib/crypto';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

beforeEach(() => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

const HOUR_MS = 3_600_000;

function buildApp(now?: () => Date) {
  return createApp({
    db,
    env: testEnv(),
    fetch: forbiddenFetch,
    ...(now !== undefined && { now }),
  });
}

const signupBody = {
  name: 'Ana Souza',
  document: '529.982.247-25',
  email: 'ana@exemplo.com',
  phone: '(47) 99999-0000',
  password: 'senha1234',
  acceptTerms: true,
  acceptPrivacy: true,
};

/** Signs up through the API and returns the session cookie and the token from the e-mailed link. */
async function signUp() {
  const result = await send(buildApp(), 'POST', '/public/auth/signup', { body: signupBody });
  const [outbox] = await db.select().from(emailOutbox);
  return {
    cookie: sessionCookieFrom(result.headers) ?? '',
    token: tokenFromEmail(outbox?.html ?? ''),
  };
}

async function verify(token: string, now?: () => Date) {
  return send(buildApp(now), 'POST', '/public/auth/verify-email', { body: { token } });
}

describe('POST /public/auth/verify-email (FND-48)', () => {
  it('verifies the e-mail of a valid link, spends the token and shows up in /app/me', async () => {
    const { cookie, token } = await signUp();

    const result = await verify(token);

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ verified: true });
    const [user] = await db.select().from(users);
    expect(user?.emailVerifiedAt).toBeInstanceOf(Date);
    const [row] = await db.select().from(authTokens);
    expect(row?.tokenHash).toBe(sha256Hex(token));
    expect(row?.usedAt).toBeInstanceOf(Date);
    const me = await send(buildApp(), 'GET', '/app/me', { cookie });
    expect(me.body).toMatchObject({ emailVerified: true });
  });
});

describe('POST /public/auth/verify-email: invalid links (FND-49)', () => {
  it('rejects the same token a second time with 400 INVALID_TOKEN', async () => {
    const { token } = await signUp();
    expect((await verify(token)).status).toBe(200);

    const again = await verify(token);

    expect(again.status).toBe(400);
    expect(again.error?.code).toBe('INVALID_TOKEN');
  });

  it('rejects an unknown token with 400 INVALID_TOKEN and verifies nobody', async () => {
    await signUp();

    const result = await verify('desconhecido');

    expect(result.status).toBe(400);
    expect(result.error?.code).toBe('INVALID_TOKEN');
    const [user] = await db.select().from(users);
    expect(user?.emailVerifiedAt).toBeNull();
  });

  it('rejects a token older than 24 hours but accepts one just inside the window', async () => {
    const { token } = await signUp();

    const late = await verify(token, () => new Date(Date.now() + 24 * HOUR_MS + 60_000));
    expect(late.status).toBe(400);
    expect(late.error?.code).toBe('INVALID_TOKEN');
    const [unverified] = await db.select().from(users);
    expect(unverified?.emailVerifiedAt).toBeNull();

    const inside = await verify(token, () => new Date(Date.now() + 24 * HOUR_MS - 60_000));
    expect(inside.status).toBe(200);
  });
});

describe('POST /app/auth/verify-email/resend (FND-50)', () => {
  it('queues a new verification e-mail with a working link and answers 202', async () => {
    const user = await createUser(db, { email: 'ana@exemplo.com', verified: false });
    const cookie = await loginAs(db, user);

    const result = await send(buildApp(), 'POST', '/app/auth/verify-email/resend', { cookie });

    expect(result.status).toBe(202);
    const outbox = await db.select().from(emailOutbox);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({
      toAddress: 'ana@exemplo.com',
      template: 'auth.verify_email',
      status: 'not_sent',
    });
    const token = tokenFromEmail(outbox[0]?.html ?? '');
    const [row] = await db.select().from(authTokens).where(eq(authTokens.userId, user.id));
    expect(row).toMatchObject({ purpose: 'email_verify', tokenHash: sha256Hex(token) });
    expect((await verify(token)).status).toBe(200);
  });

  it('refuses the fourth resend within an hour with 429 and Retry-After', async () => {
    const user = await createUser(db, { verified: false });
    const cookie = await loginAs(db, user);

    for (let call = 1; call <= 3; call++) {
      const accepted = await send(buildApp(), 'POST', '/app/auth/verify-email/resend', { cookie });
      expect(accepted.status).toBe(202);
    }
    const fourth = await send(buildApp(), 'POST', '/app/auth/verify-email/resend', { cookie });

    expect(fourth.status).toBe(429);
    expect(fourth.error?.code).toBe('TOO_MANY_ATTEMPTS');
    const retryAfter = Number(fourth.headers.get('Retry-After'));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(3600);
    expect(await db.select().from(emailOutbox)).toHaveLength(3);
    expect(await db.select().from(authTokens)).toHaveLength(3);
  }, 60_000);

  it('answers 409 CONFLICT for an already verified user and queues nothing', async () => {
    const user = await createUser(db, { verified: true });

    const result = await send(buildApp(), 'POST', '/app/auth/verify-email/resend', {
      cookie: await loginAs(db, user),
    });

    expect(result.status).toBe(409);
    expect(result.error?.code).toBe('CONFLICT');
    expect(await db.select().from(emailOutbox)).toHaveLength(0);
  });
});
