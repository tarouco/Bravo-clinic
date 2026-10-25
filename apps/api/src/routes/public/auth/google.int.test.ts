import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from 'jose';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createUser } from '../../../../test/factories';
import { send, sessionCookieFrom, testEnv, type Sent } from '../../../../test/http';
import { requireTestDatabaseUrl } from '../../../../test/require-test-db';
import { createApp } from '../../../app';
import { createDb } from '../../../db/client';
import { auditLog, sessions, users } from '../../../db/schema';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

vi.setConfig({ testTimeout: 60_000 });

const CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
const CLIENT_SECRET = 'test-client-secret';
const KID = 'test-key';
const googleEnv = testEnv({ GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_CLIENT_SECRET: CLIENT_SECRET });

type SigningKey = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
let privateKey: SigningKey;
let jwks: JWTVerifyGetKey;
let strangerKey: SigningKey;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  strangerKey = (await generateKeyPair('RS256')).privateKey;
  jwks = createLocalJWKSet({
    keys: [{ ...(await exportJWK(pair.publicKey)), kid: KID, alg: 'RS256', use: 'sig' }],
  });
});

afterAll(async () => {
  await pool.end();
});

beforeEach(() => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

interface IdTokenOptions {
  sub?: string;
  email?: string;
  emailVerified?: boolean;
  name?: string;
  audience?: string;
  key?: SigningKey;
}

async function idToken(options: IdTokenOptions = {}): Promise<string> {
  return new SignJWT({
    email: options.email ?? 'ana@exemplo.com',
    email_verified: options.emailVerified ?? true,
    name: options.name ?? 'Ana Souza',
  })
    .setProtectedHeader({ alg: 'RS256', kid: KID })
    .setSubject(options.sub ?? 'google-sub-1')
    .setIssuer('https://accounts.google.com')
    .setAudience(options.audience ?? CLIENT_ID)
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(options.key ?? privateKey);
}

/** Token endpoint stub that records the form it received. */
function tokenEndpoint(token: Promise<string>) {
  return vi.fn<typeof fetch>(async () =>
    Response.json({ id_token: await token, access_token: 'unused' }),
  );
}

function buildApp(fetchStub?: typeof fetch, env = googleEnv) {
  return createApp({
    db,
    env,
    fetch: fetchStub ?? (() => Promise.reject(new Error('unexpected network call'))),
    googleJwks: jwks,
  });
}

function cookieNamed(result: Sent, name: string): string | undefined {
  return result.headers.getSetCookie().find((value) => value.startsWith(`${name}=`));
}

/** Runs /start, then /callback with the state Google would echo back. */
async function loginWithGoogle(token: Promise<string>, overrides: { state?: string } = {}) {
  const fetchStub = tokenEndpoint(token);
  const app = buildApp(fetchStub);
  const start = await send(app, 'GET', '/public/auth/google/start');
  const location = new URL(start.headers.get('Location') ?? '');
  const stateCookie = (cookieNamed(start, 'bravo_google_oauth') ?? '').split(';')[0] ?? '';
  const callback = await send(
    app,
    'GET',
    `/public/auth/google/callback?code=auth-code&state=${overrides.state ?? location.searchParams.get('state') ?? ''}`,
    { cookie: stateCookie },
  );
  return { start, location, callback, fetchStub };
}

describe('GET /public/auth/google/start (FND-131, FND-134)', () => {
  it('answers 404 FEATURE_DISABLED without Google credentials', async () => {
    const result = await send(buildApp(undefined, testEnv()), 'GET', '/public/auth/google/start');

    expect(result.status).toBe(404);
    expect(result.error?.code).toBe('FEATURE_DISABLED');
    expect(cookieNamed(result, 'bravo_google_oauth')).toBeUndefined();
  });

  it('redirects to Google with state, S256 challenge and scopes, and sets a 10-minute HttpOnly state cookie', async () => {
    const result = await send(buildApp(), 'GET', '/public/auth/google/start');

    expect(result.status).toBe(302);
    const location = result.headers.get('Location') ?? '';
    const url = new URL(location);
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(location).toContain('scope=openid%20email%20profile');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'http://localhost:5173/api/public/auth/google/callback',
    );
    const state = url.searchParams.get('state');
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const cookie = cookieNamed(result, 'bravo_google_oauth') ?? '';
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Max-Age=600');
    const [cookieState, verifier] = (cookie.split(';')[0] ?? '').split('=')[1]?.split('.') ?? [];
    expect(cookieState).toBe(state);
    expect(
      createHash('sha256')
        .update(verifier ?? '')
        .digest('base64url'),
    ).toBe(url.searchParams.get('code_challenge'));
  });
});

describe('GET /public/auth/google/callback: login (FND-132)', () => {
  it('creates a verified tenant without document and sends them to complete the profile', async () => {
    const { callback, fetchStub, location } = await loginWithGoogle(idToken());

    expect(callback.status).toBe(302);
    expect(callback.headers.get('Location')).toBe('/app/perfil?completar=1');
    const [user] = await db.select().from(users);
    expect(user).toMatchObject({
      email: 'ana@exemplo.com',
      name: 'Ana Souza',
      role: 'tenant',
      googleSub: 'google-sub-1',
      docType: null,
      docNumber: null,
      passwordHash: null,
    });
    expect(user?.emailVerifiedAt).toBeInstanceOf(Date);

    const session = cookieNamed(callback, 'bravo_session') ?? '';
    expect(session).toContain('HttpOnly');
    expect(await db.select().from(sessions)).toHaveLength(1);
    const me = await send(buildApp(), 'GET', '/app/me', {
      cookie: sessionCookieFrom(callback.headers) ?? '',
    });
    expect(me.body).toMatchObject({ email: 'ana@exemplo.com', emailVerified: true, docType: null });

    // The code was exchanged with the client credentials and the PKCE verifier.
    const call = fetchStub.mock.calls[0];
    expect(call?.[0]).toBe('https://oauth2.googleapis.com/token');
    const form = (call?.[1] as { body: URLSearchParams }).body;
    expect(form.get('code')).toBe('auth-code');
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('client_secret')).toBe(CLIENT_SECRET);
    expect(
      createHash('sha256')
        .update(form.get('code_verifier') ?? '')
        .digest('base64url'),
    ).toBe(location.searchParams.get('code_challenge'));
    expect(cookieNamed(callback, 'bravo_google_oauth')).toContain('Max-Age=0');
  });

  it('links an existing user with the same verified e-mail and redirects to /app', async () => {
    const existing = await createUser(db, { email: 'ana@exemplo.com', password: 'senha1234' });
    await db
      .update(users)
      .set({ docType: 'cpf', docNumber: '52998224725' })
      .where(eq(users.id, existing.id));

    const { callback } = await loginWithGoogle(idToken({ email: 'Ana@Exemplo.com' }));

    expect(callback.status).toBe(302);
    expect(callback.headers.get('Location')).toBe('/app');
    const rows = await db.select().from(users);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: existing.id, googleSub: 'google-sub-1' });
    expect(rows[0]?.passwordHash).toBe(existing.passwordHash);
  });

  it('recognises a returning Google user by google_sub even after the e-mail changed', async () => {
    const existing = await createUser(db, { email: 'antigo@exemplo.com' });
    await db.update(users).set({ googleSub: 'google-sub-1' }).where(eq(users.id, existing.id));

    const { callback } = await loginWithGoogle(idToken({ email: 'novo@exemplo.com' }));

    expect(callback.status).toBe(302);
    const rows = await db.select().from(users);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: existing.id, email: 'antigo@exemplo.com' });
    expect(await db.select().from(sessions)).toHaveLength(1);
  });

  it('drops the password and sessions of an account whose e-mail was never verified when Google claims it', async () => {
    const squatter = await createUser(db, {
      email: 'ana@exemplo.com',
      password: 'senha1234',
      verified: false,
    });
    const session = await db
      .insert(sessions)
      .values({ userId: squatter.id, expiresAt: new Date(Date.now() + 3_600_000) })
      .returning();

    await loginWithGoogle(idToken());

    const [user] = await db.select().from(users).where(eq(users.id, squatter.id));
    expect(user?.passwordHash).toBeNull();
    expect(user?.emailVerifiedAt).toBeInstanceOf(Date);
    expect(user?.googleSub).toBe('google-sub-1');
    const [old] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, session[0]?.id ?? ''));
    expect(old?.revokedAt).toBeInstanceOf(Date);
  });

  it('audits a staff login through Google', async () => {
    const staff = await createUser(db, { role: 'reception', email: 'ana@exemplo.com' });

    await loginWithGoogle(idToken());

    const [entry] = await db.select().from(auditLog);
    expect(entry).toMatchObject({ action: 'auth.login_staff', actorUserId: staff.id });
  });
});

describe('GET /public/auth/google/callback: failures (FND-133)', () => {
  it('rejects a state that differs from the cookie with 400 INVALID_STATE and no session', async () => {
    const { callback, fetchStub } = await loginWithGoogle(idToken(), { state: 'forged' });

    expect(callback.status).toBe(400);
    expect(callback.error?.code).toBe('INVALID_STATE');
    expect(cookieNamed(callback, 'bravo_session')).toBeUndefined();
    expect(cookieNamed(callback, 'bravo_google_oauth')).toContain('Max-Age=0');
    expect(fetchStub).not.toHaveBeenCalled();
    expect(await db.select().from(users)).toHaveLength(0);
    expect(await db.select().from(sessions)).toHaveLength(0);
  });

  it('rejects a callback without the state cookie with 400 INVALID_STATE', async () => {
    const result = await send(buildApp(), 'GET', '/public/auth/google/callback?code=x&state=abc');

    expect(result.status).toBe(400);
    expect(result.error?.code).toBe('INVALID_STATE');
    expect(cookieNamed(result, 'bravo_session')).toBeUndefined();
  });

  it.each([
    ['an ID token signed by another key', () => idToken({ key: strangerKey })],
    ['an ID token for another client', () => idToken({ audience: 'someone-else' })],
    ['a Google e-mail that is not verified', () => idToken({ emailVerified: false })],
  ])('refuses %s with 400 and creates nothing', async (_label, makeToken) => {
    const { callback } = await loginWithGoogle(makeToken());

    expect(callback.status).toBe(400);
    expect(callback.error?.code).toBe('BAD_REQUEST');
    expect(cookieNamed(callback, 'bravo_session')).toBeUndefined();
    expect(await db.select().from(users)).toHaveLength(0);
  });
});
