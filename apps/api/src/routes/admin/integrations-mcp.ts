import { idSchema, mcpTokenInputSchema } from '@bravo/core';
import { Hono } from 'hono';
import { z } from 'zod';
import { withTransaction } from '../../db/client';
import type { Env } from '../../env';
import { audit } from '../../lib/audit';
import { actorContext, appUrl } from '../../lib/request-meta';
import { mcpToolCatalog } from '../../mcp/tools';
import { validate } from '../../middleware/validate';
import { issueToken, listTokens, revokeToken } from '../../modules/mcp/mcp-token.service';
import { loadSettings, saveSetting } from '../../modules/settings/settings.repo';
import type { AppEnv } from '../../types';

const idParam = z.object({ id: idSchema });
const enabledSchema = z.object({ enabled: z.boolean({ error: 'Informe se o MCP está ativo' }) });

/** Shown when `API_FUNCTION_URL` is unset and clients would go through the site proxy (GES-63). */
export const PROXY_URL_WARNING =
  'Este endereço passa pelo proxy do site, que encerra requisições longas (cerca de 26 s). Configure API_FUNCTION_URL para usar o endereço direto da função.';

/** The URL MCP clients should use: the native function URL when known (AD-028). */
export function mcpServerUrl(env: Pick<Env, 'API_FUNCTION_URL' | 'APP_BASE_URL'>) {
  if (env.API_FUNCTION_URL !== undefined) {
    return { serverUrl: `${env.API_FUNCTION_URL.replace(/\/+$/, '')}/mcp`, serverUrlWarning: null };
  }
  return { serverUrl: appUrl(env, '/api/mcp'), serverUrlWarning: PROXY_URL_WARNING };
}

/** MCP tab (GES-53, GES-54, GES-63); `adminRoutes` limits it to admins (GES-120). */
export function adminIntegrationsMcpRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/integrations/mcp', async (c) => {
    const { db, env } = c.var.deps;
    const tools = c.var.deps.mcpTools ?? mcpToolCatalog();
    return c.json({
      enabled: (await loadSettings(db))['mcp.enabled'],
      ...mcpServerUrl(env),
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        scope: t.scope,
        destructive: t.destructive,
      })),
      tokens: await listTokens(db),
    });
  });

  app.put('/integrations/mcp', validate('json', enabledSchema), async (c) => {
    const ctx = actorContext(c);
    const { enabled } = c.req.valid('json');
    await withTransaction(c.var.deps.db, async (tx) => {
      const before = (await loadSettings(tx))['mcp.enabled'];
      await saveSetting(tx, 'mcp.enabled', enabled, ctx.actorUserId);
      await audit(tx, ctx, {
        action: 'integration.mcp_update',
        entityType: 'setting',
        entityId: 'mcp.enabled',
        before: { enabled: before },
        after: { enabled },
      });
    });
    return c.json({ enabled });
  });

  app.post('/integrations/mcp/tokens', validate('json', mcpTokenInputSchema), async (c) => {
    const { db, now } = c.var.deps;
    const ctx = actorContext(c);
    const issued = await withTransaction(db, (tx) =>
      issueToken(tx, ctx, c.req.valid('json'), now()),
    );
    return c.json(issued, 201);
  });

  app.delete('/integrations/mcp/tokens/:id', validate('param', idParam), async (c) => {
    const { db, now } = c.var.deps;
    const ctx = actorContext(c);
    await withTransaction(db, (tx) => revokeToken(tx, ctx, c.req.valid('param').id, now()));
    return c.body(null, 204);
  });
  return app;
}
