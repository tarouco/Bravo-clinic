import type { PaymentConfig } from '@bravo/core';
import { Hono } from 'hono';
import { activeProvider, loadGatewayConfig } from '../../payments/resolver';
import type { AppEnv } from '../../types';

/**
 * `GET /public/payment-config` (NUC-129): which gateway the checkout talks to. The public key is
 * the only credential that ever leaves the server, and the sandbox has none.
 */
export function paymentConfigRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/payment-config', async (c) => {
    const { db, env } = c.var.deps;
    const provider = await activeProvider(db);
    if (provider === 'sandbox') {
      const body: PaymentConfig = { provider, publicKey: null, environment: 'test' };
      return c.json(body);
    }
    const config = await loadGatewayConfig(db, provider, env);
    const body: PaymentConfig = {
      provider,
      publicKey: config?.credentials['publicKey'] || null,
      environment: config?.environment ?? 'test',
    };
    return c.json(body);
  });

  return app;
}
