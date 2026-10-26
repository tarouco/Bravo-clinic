import { parseFixture } from '../../test/fixtures/parse';
import { gatewayOverviewSchema, type GatewayOverview } from './contracts';

// Integrações fixtures for the web tests, validated against the response contracts (AD-035).

export interface GatewayFixtureOptions {
  /** Provider marked active; the sandbox by default. */
  activeProvider?: string;
  productionWarning?: boolean;
  /** Mercado Pago already configured and enabled (production), with a stored secret. */
  mercadoPagoConfigured?: boolean;
}

/** Sandbox (no fields, always usable) and Mercado Pago (two secrets and a public key). */
export function buildGateway(options: GatewayFixtureOptions = {}): GatewayOverview {
  const configured = options.mercadoPagoConfigured ?? true;
  return parseFixture(
    gatewayOverviewSchema,
    {
      activeProvider: options.activeProvider ?? 'sandbox',
      productionWarning: options.productionWarning ?? false,
      adapters: [
        {
          provider: 'sandbox',
          label: 'Sandbox (simulado)',
          fields: [],
          configured: true,
          enabled: true,
          environment: 'test',
          secretHint: null,
          config: {},
          webhookUrl: 'https://bravoclinic.example/api/webhooks/pagamentos/sandbox',
        },
        {
          provider: 'mercadopago',
          label: 'Mercado Pago',
          fields: [
            { key: 'accessToken', label: 'Access token', secret: true },
            { key: 'webhookSecret', label: 'Assinatura secreta do webhook', secret: true },
            { key: 'publicKey', label: 'Public key', secret: false },
          ],
          configured,
          enabled: configured,
          environment: configured ? 'production' : null,
          secretHint: configured ? '••••a1b2' : null,
          config: configured ? { publicKey: 'APP_USR-public-key' } : {},
          webhookUrl: 'https://bravoclinic.example/api/webhooks/pagamentos/mercadopago',
        },
      ],
    },
    'gatewayOverview',
  );
}
