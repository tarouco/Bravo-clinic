import { eq } from 'drizzle-orm';
import type { Db, Tx } from '../db/client';
import { integrationSettings } from '../db/schema';
import type { Env } from '../env';
import { decryptSecret } from '../lib/crypto';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';
import { loadSettings } from '../modules/settings/settings.repo';
import { createSandboxGateway } from './adapters/sandbox';
import { isProviderId, type PaymentGateway, type ProviderId } from './gateway';

export interface GatewayDeps {
  db: Db | Tx;
  env: Env;
  fetch: typeof fetch;
  now?: () => Date;
}

export type GatewayEnvironment = 'test' | 'production';

export interface GatewayConfig {
  enabled: boolean;
  environment: GatewayEnvironment;
  /** Non-secret `config` merged with the decrypted secret fields. */
  credentials: Record<string, string>;
}

export const gatewayNotConfigured = () =>
  new AppError(
    503,
    'GATEWAY_NOT_CONFIGURED',
    'Pagamento online indisponível. Fale com a recepção.',
  );

/** Credentials a provider cannot work without; the sandbox needs none. */
const REQUIRED_CREDENTIALS: Record<ProviderId, readonly string[]> = {
  sandbox: [],
  mercadopago: ['accessToken'],
};

/** `payment.active_gateway`: the provider of every new charge (NUC-106). */
export async function activeProvider(db: Db | Tx): Promise<ProviderId> {
  return (await loadSettings(db))['payment.active_gateway'];
}

/**
 * The provider's row of `integration_settings` (key `gateway.<provider>`) with secrets decrypted
 * by `ENCRYPTION_KEY`, or null when missing or unreadable. Secrets never leave this module's
 * callers except as adapter inputs.
 */
export async function loadGatewayConfig(
  db: Db | Tx,
  provider: ProviderId,
  env: Pick<Env, 'ENCRYPTION_KEY'>,
): Promise<GatewayConfig | null> {
  const [row] = await db
    .select()
    .from(integrationSettings)
    .where(eq(integrationSettings.key, `gateway.${provider}`));
  if (row === undefined) return null;
  const credentials: Record<string, string> = {};
  for (const [key, value] of Object.entries(row.config as Record<string, unknown>)) {
    if (typeof value === 'string') credentials[key] = value;
  }
  if (row.secretCiphertext !== null) {
    try {
      const secrets: unknown = JSON.parse(decryptSecret(row.secretCiphertext, env.ENCRYPTION_KEY));
      for (const [key, value] of Object.entries((secrets ?? {}) as Record<string, unknown>)) {
        if (typeof value === 'string') credentials[key] = value;
      }
    } catch {
      logger.error('gateway credentials unreadable', { provider });
      return null;
    }
  }
  return {
    enabled: row.enabled,
    environment: row.environment === 'production' ? 'production' : 'test',
    credentials,
  };
}

type Factory = (ctx: GatewayDeps & { config: GatewayConfig | null }) => PaymentGateway | null;

const factories: Partial<Record<ProviderId, Factory>> = {
  sandbox: ({ env, now }) => createSandboxGateway({ env, ...(now !== undefined && { now }) }),
};

/**
 * The adapter for `provider`. Throws 503 `GATEWAY_NOT_CONFIGURED` when its credentials are absent
 * (NUC-125). Use the provider stored on a charge for status, cancel and refund calls, and
 * `activeProvider` for new ones (NUC-106).
 */
export async function resolveGateway(
  provider: ProviderId,
  deps: GatewayDeps,
): Promise<PaymentGateway> {
  const factory = factories[provider];
  if (factory === undefined) throw gatewayNotConfigured();
  const required = REQUIRED_CREDENTIALS[provider];
  const config =
    required.length === 0 ? null : await loadGatewayConfig(deps.db, provider, deps.env);
  if (required.length > 0) {
    const missing = config === null || required.some((key) => !config.credentials[key]);
    if (missing) throw gatewayNotConfigured();
  }
  const gateway = factory({ ...deps, config });
  if (gateway === null) throw gatewayNotConfigured();
  return gateway;
}

/** The gateway of an existing charge, or the active one for a charge that does not exist yet. */
export async function resolveGatewayForCharge(
  deps: GatewayDeps,
  charge?: { provider: string },
): Promise<PaymentGateway> {
  if (charge === undefined) return resolveGateway(await activeProvider(deps.db), deps);
  if (!isProviderId(charge.provider)) throw gatewayNotConfigured();
  return resolveGateway(charge.provider, deps);
}
