import { count, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { forbiddenFetch, send, testEnv } from '../../../../test/http';
import { requireTestDatabaseUrl } from '../../../../test/require-test-db';
import { createApp } from '../../../app';
import { createDb } from '../../../db/client';
import { authTokens, consents, emailOutbox, sessions, users } from '../../../db/schema';
import { sha256Hex } from '../../../lib/crypto';
import type { Env } from '../../../env';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

beforeEach(() => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

const validBody = {
  name: 'Dra. Camila Souza',
  document: '529.982.247-25',
  email: 'Camila@Exemplo.com',
  phone: '(47) 99999-0000',
  profession: 'Dermatologista',
  professionalRegistry: 'CRM-SC 12345',
  password: 'senha1234',
  acceptTerms: true,
  acceptPrivacy: true,
};

function buildApp(options: { env?: Env; fetch?: typeof fetch } = {}) {
  return createApp({
    db,
    env: options.env ?? testEnv(),
    fetch: options.fetch ?? forbiddenFetch,
  });
}

async function signup(body: Record<string, unknown>, extra: Record<string, string> = {}) {
  return send(buildApp(), 'POST', '/public/auth/signup', { body, headers: extra });
}

async function countUsers(): Promise<number> {
  const [row] = await db.select({ n: count() }).from(users);
  return row?.n ?? 0;
}

describe('POST /public/auth/signup (FND-43)', () => {
  it('creates the tenant, consents, verification token, outbox e-mail and session', async () => {
    const result = await signup(validBody, {
      'X-Forwarded-For': '203.0.113.7',
      'User-Agent': 'vitest-agent',
    });

    expect(result.status).toBe(201);
    const { user } = result.body as { user: Record<string, unknown> };
    expect(user).toMatchObject({
      email: 'camila@exemplo.com',
      name: 'Dra. Camila Souza',
      role: 'tenant',
      emailVerified: false,
      docType: 'cpf',
      mfa: { enrolled: false, verified: false },
    });
    // Same shape as GET /app/me (the web guards rely on it): exactly these keys.
    expect(Object.keys(user).sort()).toEqual(
      ['docType', 'email', 'emailVerified', 'id', 'mfa', 'name', 'role'].sort(),
    );
    expect(JSON.stringify(result.body)).not.toMatch(/password/i);

    const [row] = await db.select().from(users);
    expect(row).toMatchObject({
      id: user.id,
      email: 'camila@exemplo.com',
      role: 'tenant',
      docType: 'cpf',
      docNumber: '52998224725',
      phone: '+5547999990000',
      profession: 'Dermatologista',
      professionalRegistry: 'CRM-SC 12345',
      emailVerifiedAt: null,
    });
    expect(row?.passwordHash?.startsWith('scrypt$')).toBe(true);

    const setCookie = result.headers.getSetCookie().find((c) => c.startsWith('bravo_session='));
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Max-Age=2592000');
    const sessionRows = await db.select().from(sessions);
    expect(sessionRows).toHaveLength(1);
    expect(sessionRows[0]).toMatchObject({ userId: row?.id, mfaVerifiedAt: null });

    const consentRows = await db.select().from(consents).orderBy(consents.kind);
    expect(consentRows.map((c) => [c.kind, c.version, c.ip, c.userAgent, c.userId])).toEqual([
      ['privacy', 'privacy-2026-10', '203.0.113.7', 'vitest-agent', row?.id],
      ['terms', 'terms-2026-10', '203.0.113.7', 'vitest-agent', row?.id],
    ]);
    expect(consentRows.every((c) => c.acceptedAt instanceof Date)).toBe(true);

    const [tokenRow] = await db.select().from(authTokens);
    expect(tokenRow).toMatchObject({ userId: row?.id, purpose: 'email_verify', usedAt: null });
    expect(tokenRow?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    const lifetimeMs = (tokenRow?.expiresAt.getTime() ?? 0) - Date.now();
    expect(lifetimeMs).toBeGreaterThan(24 * 3_600_000 - 60_000);
    expect(lifetimeMs).toBeLessThanOrEqual(24 * 3_600_000);

    const outbox = await db.select().from(emailOutbox);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({
      toAddress: 'camila@exemplo.com',
      template: 'auth.verify_email',
      subject: 'Confirme seu e-mail na Bravô Clinic',
      status: 'not_sent',
    });
    const linked = /\/verificar-email\?token=([A-Za-z0-9_-]+)/.exec(outbox[0]?.html ?? '');
    expect(linked).not.toBeNull();
    expect(sha256Hex(linked?.[1] ?? '')).toBe(tokenRow?.tokenHash);
  });

  it('sends the verification e-mail through Resend after the commit', async () => {
    const fetchStub = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(JSON.stringify({ id: 'em_signup' }), { status: 200 })),
    );
    const app = buildApp({ env: testEnv({ RESEND_API_KEY: 're_test_key' }), fetch: fetchStub });

    const result = await send(app, 'POST', '/public/auth/signup', { body: validBody });

    expect(result.status).toBe(201);
    expect(fetchStub).toHaveBeenCalledTimes(1);
    const [outbox] = await db.select().from(emailOutbox);
    expect(outbox).toMatchObject({ status: 'sent', providerMessageId: 'em_signup' });
  });

  it('still returns 201 when the e-mail provider fails (FND-80)', async () => {
    const failing = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response('boom', { status: 500 })),
    );
    const app = buildApp({ env: testEnv({ RESEND_API_KEY: 're_test_key' }), fetch: failing });

    const result = await send(app, 'POST', '/public/auth/signup', { body: validBody });

    expect(result.status).toBe(201);
    expect(await countUsers()).toBe(1);
    const [outbox] = await db.select().from(emailOutbox);
    expect(outbox).toMatchObject({ status: 'failed', attempts: 1 });
  });
});

describe('signup validation (FND-44, FND-47)', () => {
  it('rejects an invalid document with 422 and the pt-BR detail on path document', async () => {
    const result = await signup({ ...validBody, document: '529.982.247-24' });

    expect(result.status).toBe(422);
    expect(result.error?.code).toBe('VALIDATION_FAILED');
    expect(result.error?.details).toContainEqual({
      path: 'document',
      message: 'CPF ou CNPJ inválido',
    });
    expect(await countUsers()).toBe(0);
  });

  it.each([
    ['acceptTerms', { acceptTerms: false }],
    ['acceptPrivacy', { acceptPrivacy: false }],
  ])('rejects %s: false with 422 and creates no user', async (field, override) => {
    const result = await signup({ ...validBody, ...override });

    expect(result.status).toBe(422);
    expect(result.error?.details?.map((d) => d.path)).toContain(field);
    expect(await countUsers()).toBe(0);
    const [{ n: consentCount } = { n: -1 }] = await db.select({ n: count() }).from(consents);
    expect(consentCount).toBe(0);
  });
});

describe('signup uniqueness (FND-45, FND-46)', () => {
  it('returns 409 EMAIL_TAKEN for the same e-mail in another case, ignoring surrounding spaces', async () => {
    expect((await signup(validBody)).status).toBe(201);

    const result = await signup({
      ...validBody,
      email: '  CAMILA@exemplo.COM ',
      document: '11.222.333/0001-81',
    });

    expect(result.status).toBe(409);
    expect(result.error?.code).toBe('EMAIL_TAKEN');
    expect(await countUsers()).toBe(1);
  });

  it('returns 409 DOCUMENT_TAKEN for a document that already belongs to a user', async () => {
    expect((await signup(validBody)).status).toBe(201);

    const result = await signup({
      ...validBody,
      email: 'outra@exemplo.com',
      document: '52998224725',
    });

    expect(result.status).toBe(409);
    expect(result.error?.code).toBe('DOCUMENT_TAKEN');
    expect(await countUsers()).toBe(1);
  });

  it('creates exactly one user when the same e-mail signs up twice at once', async () => {
    const [first, second] = await Promise.all([
      signup(validBody),
      signup({ ...validBody, document: '11.222.333/0001-81' }),
    ]);

    expect([first.status, second.status].sort()).toEqual([201, 409]);
    const loser = first.status === 409 ? first : second;
    expect(loser.error?.code).toBe('EMAIL_TAKEN');
    expect(await countUsers()).toBe(1);
    const [row] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.role, 'tenant'));
    expect(row?.email).toBe('camila@exemplo.com');
  });
});
