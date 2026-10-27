import type { GatewayCredentialsInput } from '@bravo/core';
import { and, eq, ne } from 'drizzle-orm';
import type { Db, Tx } from '../../db/client';
import {
  bookingCategories,
  integrationSettings,
  savedCards,
  subscriptions,
  users,
} from '../../db/schema';
import { cardReregisterTemplate } from '../../emails/templates/gestao';
import type { Env } from '../../env';
import { audit, type RequestContext } from '../../lib/audit';
import { decryptSecret, encryptSecret } from '../../lib/crypto';
import { AppError, notFound, validationFailed } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { appUrl } from '../../lib/request-meta';
import { createMercadoPagoGateway } from '../../payments/adapters/mercadopago';
import { createSandboxGateway } from '../../payments/adapters/sandbox';
import {
  isProviderId,
  listGatewayAdapters,
  type GatewayAdapterInfo,
  type PaymentGateway,
  type ProviderId,
} from '../../payments/gateway';
import { activeProvider, loadGatewayConfig } from '../../payments/resolver';
import { withNotifications, type NotificationDeps } from '../notifications/notifications.service';
import { saveSetting } from '../settings/settings.repo';

// Payment gateway configuration (GES-35..GES-41), built on nucleo's adapter registry (R5).
// Secrets are stored encrypted as one JSON object and never leave this module: the listing shows
// only `secretHint`, and the audit rows only say which secret fields are set.

/** Upper bound of a "Testar conexão" call (GES-37). */
export const GATEWAY_TEST_TIMEOUT_MS = 10_000;

type SettingsRow = typeof integrationSettings.$inferSelect;

export interface GatewayAdapterView {
  provider: ProviderId;
  label: string;
  fields: GatewayAdapterInfo['credentialFields'];
  configured: boolean;
  enabled: boolean;
  environment: 'test' | 'production' | null;
  secretHint: string | null;
  config: Record<string, string>;
  webhookUrl: string;
  active: boolean;
}

const settingsKey = (provider: ProviderId) => `gateway.${provider}`;

const webhookUrl = (env: Pick<Env, 'APP_BASE_URL'>, provider: ProviderId) =>
  appUrl(env, `/api/webhooks/pagamentos/${provider}`);

/** `••••` plus the last 4 characters (GES-36). */
export const secretHintOf = (secret: string) => `••••${secret.slice(-4)}`;

function adapterInfo(provider: string): GatewayAdapterInfo {
  const info = isProviderId(provider)
    ? listGatewayAdapters().find((a) => a.provider === provider)
    : undefined;
  if (info === undefined) throw notFound('NOT_FOUND', 'Provedor de pagamento não encontrado');
  return info;
}

async function loadRow(db: Db | Tx, provider: ProviderId): Promise<SettingsRow | undefined> {
  const [row] = await db
    .select()
    .from(integrationSettings)
    .where(eq(integrationSettings.key, settingsKey(provider)));
  return row;
}

function storedSecrets(row: SettingsRow | undefined, env: Pick<Env, 'ENCRYPTION_KEY'>) {
  if (row?.secretCiphertext == null) return {} as Record<string, string>;
  try {
    const parsed: unknown = JSON.parse(decryptSecret(row.secretCiphertext, env.ENCRYPTION_KEY));
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries((parsed ?? {}) as Record<string, unknown>)) {
      if (typeof value === 'string' && value !== '') out[key] = value;
    }
    return out;
  } catch {
    logger.error('gateway credentials unreadable', { key: row.key });
    return {};
  }
}

function storedConfig(row: SettingsRow | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries((row?.config ?? {}) as Record<string, unknown>)) {
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

/** Every secret field has a stored value (the sandbox has none and is always configured). */
function isConfigured(info: GatewayAdapterInfo, secrets: Record<string, string>): boolean {
  return info.credentialFields.filter((f) => f.secret).every((f) => secrets[f.key] !== undefined);
}

function view(
  info: GatewayAdapterInfo,
  row: SettingsRow | undefined,
  env: Pick<Env, 'APP_BASE_URL' | 'ENCRYPTION_KEY'>,
  active: ProviderId,
): GatewayAdapterView {
  const sandbox = info.credentialFields.length === 0;
  const secrets = storedSecrets(row, env);
  const config = storedConfig(row);
  return {
    provider: info.provider,
    label: info.label,
    fields: info.credentialFields,
    configured: sandbox || isConfigured(info, secrets),
    enabled: sandbox || row?.enabled === true,
    environment: sandbox
      ? 'test'
      : row?.environment === 'production'
        ? 'production'
        : row
          ? 'test'
          : null,
    secretHint: row?.secretHint ?? null,
    config: Object.fromEntries(
      info.credentialFields
        .filter((f) => !f.secret && config[f.key] !== undefined)
        .map((f) => [f.key, config[f.key] ?? '']),
    ),
    webhookUrl: webhookUrl(env, info.provider),
    active: active === info.provider,
  };
}

/** `GET /admin/integrations/gateway` (GES-35, GES-41). */
export async function listGateways(db: Db | Tx, env: Env) {
  const active = await activeProvider(db);
  const adapters: GatewayAdapterView[] = [];
  for (const info of listGatewayAdapters()) {
    adapters.push(view(info, await loadRow(db, info.provider), env, active));
  }
  const activeView = adapters.find((a) => a.provider === active);
  const productionWarning =
    env.NEON_BRANCH === 'production' &&
    (active === 'sandbox' || activeView?.environment !== 'production');
  return { activeProvider: active, productionWarning, adapters };
}

/**
 * Saves a provider's settings (GES-36): secret fields encrypted together, a field sent empty
 * keeps its stored value, the hint is taken from the first secret field.
 */
export async function saveGatewayCredentials(
  tx: Tx,
  ctx: RequestContext,
  provider: string,
  input: GatewayCredentialsInput,
  env: Env,
): Promise<GatewayAdapterView> {
  const info = adapterInfo(provider);
  if (info.credentialFields.length === 0) {
    throw new AppError(422, 'POLICY_VIOLATION', 'O gateway simulado não tem credenciais.');
  }
  const secretKeys = new Set(info.credentialFields.filter((f) => f.secret).map((f) => f.key));
  const configKeys = new Set(info.credentialFields.filter((f) => !f.secret).map((f) => f.key));
  const unknown = [
    ...Object.keys(input.config)
      .filter((k) => !configKeys.has(k))
      .map((k) => ({ path: ['config', k], message: 'Campo desconhecido' })),
    ...Object.keys(input.secrets)
      .filter((k) => !secretKeys.has(k))
      .map((k) => ({ path: ['secrets', k], message: 'Campo desconhecido' })),
  ];
  if (unknown.length > 0) throw validationFailed(unknown);

  const row = await loadRow(tx, info.provider);
  const secrets = storedSecrets(row, env);
  for (const [key, value] of Object.entries(input.secrets)) {
    if (value.trim() !== '') secrets[key] = value.trim();
  }
  const config = storedConfig(row);
  for (const [key, value] of Object.entries(input.config)) {
    if (value.trim() === '') delete config[key];
    else config[key] = value.trim();
  }
  const firstSecret = info.credentialFields
    .filter((f) => f.secret)
    .map((f) => secrets[f.key])
    .find((v) => v !== undefined);
  const values = {
    enabled: input.enabled,
    environment: input.environment,
    config,
    secretCiphertext:
      Object.keys(secrets).length === 0
        ? null
        : encryptSecret(JSON.stringify(secrets), env.ENCRYPTION_KEY),
    secretHint: firstSecret === undefined ? null : secretHintOf(firstSecret),
    updatedBy: ctx.actorUserId,
    updatedAt: new Date(),
  };
  await tx
    .insert(integrationSettings)
    .values({ key: settingsKey(info.provider), ...values })
    .onConflictDoUpdate({ target: integrationSettings.key, set: values });

  const describe = (
    r: { enabled: boolean; environment: string | null; config: unknown },
    set: string[],
  ) => ({
    enabled: r.enabled,
    environment: r.environment,
    config: r.config,
    storedFields: set.sort(),
  });
  await audit(tx, ctx, {
    action: 'integration.gateway_update',
    entityType: 'integration',
    entityId: settingsKey(info.provider),
    before: row === undefined ? null : describe(row, Object.keys(storedSecrets(row, env))),
    after: describe(values, Object.keys(secrets)),
  });
  const saved = await loadRow(tx, info.provider);
  return view(info, saved, env, await activeProvider(tx));
}

function adapterFor(
  provider: ProviderId,
  credentials: Record<string, string>,
  deps: { env: Env; fetch: typeof fetch; now: () => Date },
): PaymentGateway {
  if (provider === 'sandbox') return createSandboxGateway({ env: deps.env, now: deps.now });
  return createMercadoPagoGateway({
    credentials: { accessToken: credentials['accessToken'] ?? '' },
    env: deps.env,
    fetch: deps.fetch,
    now: deps.now,
    timeoutMs: GATEWAY_TEST_TIMEOUT_MS,
  });
}

/**
 * "Testar conexão" (GES-37) with the stored credentials: the adapter's own check, bounded by
 * 10 s; a rejection or a timeout is `{ ok: false }` with a pt-BR message, never an error.
 */
export async function testGatewayConnection(
  deps: { db: Db; env: Env; fetch: typeof fetch; now: () => Date },
  provider: string,
): Promise<{ ok: boolean; message: string }> {
  const info = adapterInfo(provider);
  const config = await loadGatewayConfig(deps.db, info.provider, deps.env);
  const credentials = config?.credentials ?? {};
  const environment = config?.environment ?? 'test';
  const timeout = new Promise<{ ok: boolean; message: string }>((resolve) => {
    const timer = setTimeout(
      () => resolve({ ok: false, message: 'O provedor não respondeu em 10 segundos.' }),
      GATEWAY_TEST_TIMEOUT_MS,
    );
    timer.unref();
  });
  try {
    return await Promise.race([
      adapterFor(info.provider, credentials, deps).verifyCredentials(credentials, environment),
      timeout,
    ]);
  } catch {
    return { ok: false, message: 'Não foi possível testar a conexão agora.' };
  }
}

/**
 * Activates a configured and enabled provider (GES-38..GES-40): `payment.active_gateway` changes,
 * existing charges keep their provider, and every active auto-renew subscription whose saved card
 * belongs to another provider gets one `subscription.card_reregister` e-mail per switch.
 */
export async function activateGateway(
  deps: NotificationDeps,
  ctx: RequestContext,
  provider: string,
): Promise<{ activeProvider: ProviderId; reregisterEmails: number }> {
  const info = adapterInfo(provider);
  return withNotifications(deps, ctx, async (tx, notify) => {
    const row = await loadRow(tx, info.provider);
    const current = view(info, row, deps.env, await activeProvider(tx));
    if (!current.configured || !current.enabled) {
      throw new AppError(
        422,
        'POLICY_VIOLATION',
        'Configure e habilite o provedor antes de ativá-lo.',
      );
    }
    const previous = await activeProvider(tx);
    if (previous === info.provider) return { activeProvider: previous, reregisterEmails: 0 };

    await saveSetting(tx, 'payment.active_gateway', info.provider, ctx.actorUserId);
    const auditId = await audit(tx, ctx, {
      action: 'integration.gateway_activate',
      entityType: 'integration',
      entityId: settingsKey(info.provider),
      before: { activeProvider: previous },
      after: { activeProvider: info.provider },
    });

    const affected = await tx
      .select({
        subscriptionId: subscriptions.id,
        userId: subscriptions.userId,
        name: users.name,
        categoryName: bookingCategories.name,
      })
      .from(subscriptions)
      .innerJoin(savedCards, eq(savedCards.id, subscriptions.savedCardId))
      .innerJoin(users, eq(users.id, subscriptions.userId))
      .innerJoin(bookingCategories, eq(bookingCategories.id, subscriptions.categoryId))
      .where(
        and(
          eq(subscriptions.status, 'active'),
          eq(subscriptions.autoRenew, true),
          eq(subscriptions.paymentMethod, 'saved_card'),
          ne(savedCards.provider, info.provider),
        ),
      );
    for (const sub of affected) {
      const mail = cardReregisterTemplate(
        { name: sub.name, categoryName: sub.categoryName },
        deps.env,
      );
      await notify({
        name: 'subscription.card_reregister',
        entityId: sub.subscriptionId,
        userId: sub.userId,
        data: { subscriptionId: sub.subscriptionId },
        email: { ...mail, dedupeKey: `card_reregister:${sub.subscriptionId}:${String(auditId)}` },
      });
    }
    return { activeProvider: info.provider, reregisterEmails: affected.length };
  });
}
