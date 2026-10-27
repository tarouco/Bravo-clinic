import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCharge, createStaff, createTenant } from '../../../test/booking-helpers';
import { createHourPackageCategory, createSubscription } from '../../../test/factories/revenue';
import { forbiddenFetch, send, testEnv } from '../../../test/http';
import { requireTestDatabaseUrl } from '../../../test/require-test-db';
import { createApp } from '../../app';
import { createDb } from '../../db/client';
import {
  auditLog,
  charges,
  emailOutbox,
  integrationSettings,
  savedCards,
  subscriptions,
} from '../../db/schema';
import { runSeed } from '../../db/seed';
import { decryptSecret } from '../../lib/crypto';
import { loadSettings } from '../../modules/settings/settings.repo';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

const NOW = new Date('2027-03-10T15:00:00.000Z');
const ACCESS_TOKEN = 'APP_USR-1234567890-secret-token-WXYZ';
const WEBHOOK_SECRET = 'whsec-very-secret-9876';

beforeEach(async () => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  await runSeed(db);
});

const buildApp = (opts: { fetch?: typeof fetch; env?: Record<string, string> } = {}) =>
  createApp({
    db,
    now: () => NOW,
    fetch: opts.fetch ?? forbiddenFetch,
    env: testEnv(opts.env ?? {}),
  });

const call = (cookie: string, method: string, path: string, body?: unknown, app = buildApp()) =>
  send(app, method, path, { cookie, ...(body !== undefined && { body }) });

const mpBody = (overrides: Record<string, unknown> = {}) => ({
  enabled: true,
  environment: 'production',
  config: { publicKey: 'APP_USR-public-key' },
  secrets: { accessToken: ACCESS_TOKEN, webhookSecret: WEBHOOK_SECRET },
  ...overrides,
});

interface AdapterBody {
  provider: string;
  configured: boolean;
  enabled: boolean;
  environment: string | null;
  secretHint: string | null;
  config: Record<string, string>;
  webhookUrl: string;
  fields: { key: string; secret: boolean }[];
  active: boolean;
}
interface Overview {
  activeProvider: string;
  productionWarning: boolean;
  adapters: AdapterBody[];
}

const overview = async (cookie: string, app = buildApp()) =>
  (await call(cookie, 'GET', '/admin/integrations/gateway', undefined, app)).body as Overview;

const mpRow = async () => {
  const [row] = await db
    .select()
    .from(integrationSettings)
    .where(eq(integrationSettings.key, 'gateway.mercadopago'));
  return row;
};

const audits = (action: string) => db.select().from(auditLog).where(eq(auditLog.action, action));

describe('GET /admin/integrations/gateway (GES-35)', () => {
  it('lists every adapter with its webhook URL and never a secret value', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const before = await overview(admin.cookie);
    await call(admin.cookie, 'PUT', '/admin/integrations/gateway/mercadopago', mpBody());

    const res = await call(admin.cookie, 'GET', '/admin/integrations/gateway');

    expect(before.adapters.find((a) => a.provider === 'mercadopago')).toMatchObject({
      configured: false,
      enabled: false,
      environment: null,
      secretHint: null,
      config: {},
    });
    expect(res.status).toBe(200);
    const body = res.body as Overview;
    expect(body.activeProvider).toBe('sandbox');
    expect(body.productionWarning).toBe(false);
    expect(body.adapters.map((a) => [a.provider, a.webhookUrl])).toEqual([
      ['sandbox', 'http://localhost:5173/api/webhooks/pagamentos/sandbox'],
      ['mercadopago', 'http://localhost:5173/api/webhooks/pagamentos/mercadopago'],
    ]);
    expect(body.adapters[0]).toMatchObject({
      provider: 'sandbox',
      configured: true,
      enabled: true,
      fields: [],
      active: true,
    });
    expect(body.adapters[1]).toMatchObject({
      provider: 'mercadopago',
      label: 'Mercado Pago',
      configured: true,
      enabled: true,
      environment: 'production',
      secretHint: '••••WXYZ',
      config: { publicKey: 'APP_USR-public-key' },
      active: false,
    });
    expect(body.adapters[1]?.fields.map((f) => [f.key, f.secret])).toEqual([
      ['accessToken', true],
      ['webhookSecret', true],
      ['publicKey', false],
    ]);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(ACCESS_TOKEN);
    expect(text).not.toContain(WEBHOOK_SECRET);
  });

  it('warns in production while the sandbox or a test-mode gateway is active (GES-41)', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const production = buildApp({ env: { NEON_BRANCH: 'production' } });

    const sandboxActive = await overview(admin.cookie, production);
    await call(
      admin.cookie,
      'PUT',
      '/admin/integrations/gateway/mercadopago',
      mpBody(),
      production,
    );
    await call(
      admin.cookie,
      'POST',
      '/admin/integrations/gateway/mercadopago/activate',
      {},
      production,
    );
    const liveActive = await overview(admin.cookie, production);
    await call(
      admin.cookie,
      'PUT',
      '/admin/integrations/gateway/mercadopago',
      mpBody({ environment: 'test', secrets: {} }),
      production,
    );
    const testModeActive = await overview(admin.cookie, production);
    const devBranch = await overview(admin.cookie);

    expect(sandboxActive.productionWarning).toBe(true);
    expect(liveActive).toMatchObject({ activeProvider: 'mercadopago', productionWarning: false });
    expect(testModeActive.productionWarning).toBe(true);
    expect(devBranch.productionWarning).toBe(false);
  });
});

describe('PUT /admin/integrations/gateway/:provider (GES-36)', () => {
  it('stores secrets encrypted with a hint and audits without secret values', async () => {
    const admin = await createStaff(db, 'admin', NOW);

    const res = await call(
      admin.cookie,
      'PUT',
      '/admin/integrations/gateway/mercadopago',
      mpBody(),
    );

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ provider: 'mercadopago', secretHint: '••••WXYZ' });
    const row = await mpRow();
    expect(row).toMatchObject({
      enabled: true,
      environment: 'production',
      config: { publicKey: 'APP_USR-public-key' },
      secretHint: '••••WXYZ',
      updatedBy: admin.user.id,
    });
    expect(row?.secretCiphertext).not.toContain(ACCESS_TOKEN);
    expect(
      JSON.parse(decryptSecret(row?.secretCiphertext ?? '', testEnv().ENCRYPTION_KEY)),
    ).toEqual({ accessToken: ACCESS_TOKEN, webhookSecret: WEBHOOK_SECRET });
    const [entry] = await audits('integration.gateway_update');
    expect(entry).toMatchObject({
      entityType: 'integration',
      entityId: 'gateway.mercadopago',
      actorUserId: admin.user.id,
      origin: 'admin',
      before: null,
      after: {
        enabled: true,
        environment: 'production',
        config: { publicKey: 'APP_USR-public-key' },
        storedFields: ['accessToken', 'webhookSecret'],
      },
    });
    expect(JSON.stringify(entry)).not.toContain(ACCESS_TOKEN);
    expect(JSON.stringify(entry)).not.toContain(WEBHOOK_SECRET);
  });

  it('keeps a stored secret when its field is sent empty and replaces the retyped one', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    await call(admin.cookie, 'PUT', '/admin/integrations/gateway/mercadopago', mpBody());

    const res = await call(
      admin.cookie,
      'PUT',
      '/admin/integrations/gateway/mercadopago',
      mpBody({ enabled: false, secrets: { accessToken: '', webhookSecret: 'whsec-new-5555' } }),
    );

    expect(res.status).toBe(200);
    const row = await mpRow();
    expect(
      JSON.parse(decryptSecret(row?.secretCiphertext ?? '', testEnv().ENCRYPTION_KEY)),
    ).toEqual({ accessToken: ACCESS_TOKEN, webhookSecret: 'whsec-new-5555' });
    expect(row).toMatchObject({ enabled: false, secretHint: '••••WXYZ' });
    const entries = await audits('integration.gateway_update');
    expect(entries).toHaveLength(2);
    expect(entries[1]?.before).toMatchObject({ enabled: true });
    expect(entries[1]?.after).toMatchObject({ enabled: false });
    expect(JSON.stringify(entries)).not.toContain('whsec-new-5555');
  });

  it('answers 422 for an unknown credential field and 404 for an unknown provider', async () => {
    const admin = await createStaff(db, 'admin', NOW);

    const unknownField = await call(
      admin.cookie,
      'PUT',
      '/admin/integrations/gateway/mercadopago',
      mpBody({ secrets: { password: 'x' } }),
    );
    const unknownProvider = await call(
      admin.cookie,
      'PUT',
      '/admin/integrations/gateway/stripe',
      mpBody(),
    );

    expect(unknownField.status).toBe(422);
    expect(unknownField.error?.details?.[0]?.path).toBe('secrets.password');
    expect(unknownProvider.status).toBe(404);
    expect(await mpRow()).toBeUndefined();
  });
});

describe('POST /admin/integrations/gateway/:provider/test (GES-37)', () => {
  it('is ok for the sandbox', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const res = await call(admin.cookie, 'POST', '/admin/integrations/gateway/sandbox/test', {});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
  });

  it('answers ok: false with a pt-BR message when Mercado Pago rejects the token (401)', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    await call(admin.cookie, 'PUT', '/admin/integrations/gateway/mercadopago', mpBody());
    const requests: { url: string; auth: string | null }[] = [];
    const fetch401: typeof fetch = (input, init) => {
      requests.push({
        url: input instanceof Request ? input.url : input.toString(),
        auth: new Headers(init?.headers).get('Authorization'),
      });
      return Promise.resolve(new Response('{"message":"invalid token"}', { status: 401 }));
    };

    const res = await call(
      admin.cookie,
      'POST',
      '/admin/integrations/gateway/mercadopago/test',
      {},
      buildApp({ fetch: fetch401 }),
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: false, message: 'Credenciais recusadas pelo Mercado Pago.' });
    expect(requests).toEqual([
      { url: 'https://api.mercadopago.com/users/me', auth: `Bearer ${ACCESS_TOKEN}` },
    ]);
  });

  it('answers ok: false when the provider call times out', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    await call(admin.cookie, 'PUT', '/admin/integrations/gateway/mercadopago', mpBody());
    const timingOut: typeof fetch = () =>
      Promise.reject(new DOMException('The operation timed out.', 'TimeoutError'));

    const res = await call(
      admin.cookie,
      'POST',
      '/admin/integrations/gateway/mercadopago/test',
      {},
      buildApp({ fetch: timingOut }),
    );

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: false });
    expect((res.body as { message: string }).message).toMatch(/Mercado Pago/);
  });
});

describe('POST /admin/integrations/gateway/:provider/activate (GES-38..GES-40)', () => {
  it('refuses an unconfigured or disabled provider with 422 POLICY_VIOLATION', async () => {
    const admin = await createStaff(db, 'admin', NOW);

    const unconfigured = await call(
      admin.cookie,
      'POST',
      '/admin/integrations/gateway/mercadopago/activate',
      {},
    );
    await call(
      admin.cookie,
      'PUT',
      '/admin/integrations/gateway/mercadopago',
      mpBody({ enabled: false }),
    );
    const disabled = await call(
      admin.cookie,
      'POST',
      '/admin/integrations/gateway/mercadopago/activate',
      {},
    );

    expect(unconfigured.status).toBe(422);
    expect(unconfigured.error?.code).toBe('POLICY_VIOLATION');
    expect(disabled.status).toBe(422);
    expect(disabled.error?.code).toBe('POLICY_VIOLATION');
    expect((await loadSettings(db))['payment.active_gateway']).toBe('sandbox');
    expect(await audits('integration.gateway_activate')).toHaveLength(0);
  });

  it('switches the active gateway, keeps old charges, and asks affected cards to re-register once', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const category = await createHourPackageCategory(db);
    const card = async (userId: string, provider: string) => {
      const [row] = await db
        .insert(savedCards)
        .values({
          userId,
          provider,
          externalCardId: `card_${randomUUID()}`,
          brand: 'visa',
          last4: '4242',
        })
        .returning();
      return row?.id ?? '';
    };
    const subscribe = async (
      provider: string,
      overrides: { status?: string; autoRenew?: boolean; method?: 'pix' | 'saved_card' } = {},
    ) => {
      const { user } = await createTenant(db, { now: NOW });
      const { subscription } = await createSubscription(db, {
        userId: user.id,
        category,
        status: overrides.status ?? 'active',
        paymentMethod: overrides.method ?? 'saved_card',
      });
      await db
        .update(subscriptions)
        .set({
          savedCardId: overrides.method === 'pix' ? null : await card(user.id, provider),
          autoRenew: overrides.autoRenew ?? true,
        })
        .where(eq(subscriptions.id, subscription.id));
      return { user, subscription };
    };
    const affected = await subscribe('sandbox');
    await subscribe('mercadopago');
    await subscribe('sandbox', { autoRenew: false });
    await subscribe('sandbox', { status: 'cancelled' });
    await subscribe('sandbox', { method: 'pix' });
    const oldCharge = await createCharge(db, {
      userId: affected.user.id,
      bookingId: null,
      purpose: 'subscription_initial',
      amountCents: 160000,
    });
    await call(admin.cookie, 'PUT', '/admin/integrations/gateway/mercadopago', mpBody());

    const res = await call(
      admin.cookie,
      'POST',
      '/admin/integrations/gateway/mercadopago/activate',
      {},
    );
    const repeat = await call(
      admin.cookie,
      'POST',
      '/admin/integrations/gateway/mercadopago/activate',
      {},
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ activeProvider: 'mercadopago', reregisterEmails: 1 });
    expect(repeat.status).toBe(200);
    expect(repeat.body).toEqual({ activeProvider: 'mercadopago', reregisterEmails: 0 });
    expect((await loadSettings(db))['payment.active_gateway']).toBe('mercadopago');
    const [charge] = await db.select().from(charges).where(eq(charges.id, oldCharge.id));
    expect(charge?.provider).toBe('sandbox');
    const [entry] = await audits('integration.gateway_activate');
    expect(entry).toMatchObject({
      actorUserId: admin.user.id,
      before: { activeProvider: 'sandbox' },
      after: { activeProvider: 'mercadopago' },
    });
    const mails = await db
      .select()
      .from(emailOutbox)
      .where(eq(emailOutbox.template, 'subscription.card_reregister'));
    expect(mails).toHaveLength(1);
    expect(mails[0]).toMatchObject({
      toAddress: affected.user.email,
      dedupeKey: `card_reregister:${affected.subscription.id}:${String(entry?.id)}`,
      status: 'not_sent',
    });
    expect(mails[0]?.textBody).toContain('/app/perfil/cartoes');
  });
});

describe('reception (GES-120)', () => {
  it('gets 403 on every gateway route', async () => {
    const reception = await createStaff(db, 'reception', NOW);

    const results = [
      await call(reception.cookie, 'GET', '/admin/integrations/gateway'),
      await call(reception.cookie, 'PUT', '/admin/integrations/gateway/mercadopago', mpBody()),
      await call(reception.cookie, 'POST', '/admin/integrations/gateway/sandbox/test', {}),
      await call(reception.cookie, 'POST', '/admin/integrations/gateway/sandbox/activate', {}),
    ];

    expect(results.map((r) => [r.status, r.error?.code])).toEqual(
      Array.from({ length: 4 }, () => [403, 'FORBIDDEN']),
    );
    expect(await mpRow()).toBeUndefined();
  });
});
