import { gatewayCredentialsSchema } from '@bravo/core';
import { Hono } from 'hono';
import { withTransaction } from '../../db/client';
import { actorContext } from '../../lib/request-meta';
import { validate } from '../../middleware/validate';
import {
  activateGateway,
  listGateways,
  saveGatewayCredentials,
  testGatewayConnection,
} from '../../modules/integrations/gateway-config.service';
import type { AppEnv } from '../../types';

/** Pagamentos tab (GES-35..GES-41); `adminRoutes` limits it to admins (GES-120). */
export function adminIntegrationsGatewayRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/integrations/gateway', async (c) =>
    c.json(await listGateways(c.var.deps.db, c.var.deps.env)),
  );

  app.put(
    '/integrations/gateway/:provider',
    validate('json', gatewayCredentialsSchema),
    async (c) => {
      const { db, env } = c.var.deps;
      const ctx = actorContext(c);
      const provider = c.req.param('provider');
      const saved = await withTransaction(db, (tx) =>
        saveGatewayCredentials(tx, ctx, provider, c.req.valid('json'), env),
      );
      return c.json(saved);
    },
  );

  app.post('/integrations/gateway/:provider/test', async (c) =>
    c.json(await testGatewayConnection(c.var.deps, c.req.param('provider'))),
  );

  app.post('/integrations/gateway/:provider/activate', async (c) =>
    c.json(await activateGateway(c.var.deps, actorContext(c), c.req.param('provider'))),
  );
  return app;
}
