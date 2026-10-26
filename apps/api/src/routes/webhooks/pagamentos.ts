import { Hono } from 'hono';
import { SYSTEM_CONTEXT } from '../../modules/payments/payment-effects.service';
import { receivePaymentWebhook } from '../../modules/payments/webhooks.service';
import type { AppEnv } from '../../types';

/**
 * `POST /webhooks/pagamentos/:provider` (public path `/api/webhooks/pagamentos/:provider`): no
 * session and no CSRF; the provider's signature is the credential (NUC-112).
 */
export function paymentWebhookRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post('/:provider', async (c) => {
    const headers: Record<string, string> = {};
    c.req.raw.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    await receivePaymentWebhook(
      c.var.deps,
      c.req.param('provider'),
      { headers, rawBody: await c.req.text(), query: c.req.query() },
      { ...SYSTEM_CONTEXT, requestId: c.get('requestId') },
    );
    return c.json({ received: true });
  });

  return app;
}
