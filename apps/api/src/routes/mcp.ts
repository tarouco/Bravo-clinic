import { Hono } from 'hono';
import { AppError, tooManyRequests, unauthorized } from '../lib/errors';
import { clientIp } from '../lib/request-meta';
import { handleMcpRequest } from '../mcp/server';
import { mcpToolCatalog } from '../mcp/tools';
import { consumeRateLimit } from '../middleware/rate-limit';
import { authenticateBearer } from '../modules/mcp/mcp-token.service';
import { loadSettings } from '../modules/settings/settings.repo';
import type { AppEnv } from '../types';

/** Rate-limit bucket of one token (GES-60). */
export const mcpRateLimitKey = (tokenId: string) => `mcp:token:${tokenId}`;

/**
 * `/mcp` (streamable HTTP, AD-011): `mcp.enabled` (404) → bearer token (401) → per-token rate limit
 * (429) → transport. Clients use the native function URL (AD-028).
 */
export function mcpRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.all('/', async (c) => {
    const deps = c.var.deps;
    const settings = await loadSettings(deps.db);
    if (!settings['mcp.enabled']) {
      throw new AppError(404, 'FEATURE_DISABLED', 'O servidor MCP está desativado.');
    }
    const now = deps.now();
    const principal = await authenticateBearer(deps.db, c.req.header('Authorization'), now);
    if (principal === null) {
      const error = unauthorized('UNAUTHENTICATED', 'Token MCP inválido ou revogado');
      throw new AppError(error.status, error.code, error.message, undefined, {
        'WWW-Authenticate': 'Bearer',
      });
    }
    const limit = await consumeRateLimit(deps.db, mcpRateLimitKey(principal.token.id), {
      limit: settings['mcp.rate_limit_per_minute'],
      windowSeconds: 60,
      now,
    });
    if (!limit.allowed) throw tooManyRequests(limit.retryAfterSeconds);
    c.set('userId', principal.owner.userId);

    const tools = deps.mcpTools ?? mcpToolCatalog();
    return handleMcpRequest(
      c.req.raw,
      tools,
      {
        deps,
        owner: principal.owner,
        tokenId: principal.token.id,
        now,
        ctx: {
          actorUserId: principal.owner.userId,
          actorRole: 'admin',
          origin: 'mcp',
          ip: clientIp(c),
          requestId: c.get('requestId'),
        },
      },
      principal.token.scope === 'read_write' ? 'read_write' : 'read',
    );
  });
  return app;
}
