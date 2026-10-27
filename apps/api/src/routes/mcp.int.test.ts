import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createStaff } from '../../test/booking-helpers';
import { forbiddenFetch, send, testEnv } from '../../test/http';
import { connectMcp, rawMcpRequest } from '../../test/mcp-client';
import { requireTestDatabaseUrl } from '../../test/require-test-db';
import { createApp } from '../app';
import { createDb, withTransaction } from '../db/client';
import { auditLog, mcpTokens, rateLimitBuckets, users } from '../db/schema';
import { runSeed } from '../db/seed';
import { sha256Hex } from '../lib/crypto';
import { defineTool } from '../mcp/server';
import { loadSettings, saveSetting } from '../modules/settings/settings.repo';
import { mcpRateLimitKey } from './mcp';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

const NOW = new Date('2027-03-10T15:00:00.000Z');
const DAY = 86_400_000;

const echo = defineTool({
  name: 'echo_test',
  description: 'Devolve o texto recebido.',
  scope: 'read',
  input: z.object({ text: z.string().min(1, { error: 'Informe o texto' }) }),
  run: (_tc, input) => Promise.resolve({ echoed: input.text }),
});

beforeEach(async () => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  await runSeed(db);
});

const buildApp = (opts: { now?: Date; env?: Record<string, string> } = {}) =>
  createApp({
    db,
    now: () => opts.now ?? NOW,
    fetch: forbiddenFetch,
    env: testEnv(opts.env),
    mcpTools: [echo],
  });

const call = (cookie: string, method: string, path: string, body?: unknown, app = buildApp()) =>
  send(app, method, path, { cookie, ...(body !== undefined && { body }) });

const enableMcp = (enabled = true) =>
  withTransaction(db, (tx) => saveSetting(tx, 'mcp.enabled', enabled, null));

async function issue(cookie: string, body: Record<string, unknown> = {}) {
  const res = await call(cookie, 'POST', '/admin/integrations/mcp/tokens', {
    name: 'Claude Desktop',
    scope: 'read',
    ...body,
  });
  expect(res.status).toBe(201);
  return res.body as { token: string; record: { id: string; prefix: string } };
}

const audits = (action: string) => db.select().from(auditLog).where(eq(auditLog.action, action));

describe('MCP tokens (GES-53, GES-54)', () => {
  it('returns a bmcp_ token once, stores only its hash and prefix, and audits the issue', async () => {
    const admin = await createStaff(db, 'admin', NOW);

    const issued = await issue(admin.cookie, { expiresInDays: 30 });

    expect(issued.token).toMatch(/^bmcp_[A-Za-z0-9_-]{43}$/);
    expect(issued.record).toEqual({
      id: expect.any(String) as string,
      name: 'Claude Desktop',
      scope: 'read',
      prefix: issued.token.slice(0, 11),
      createdAt: NOW.toISOString(),
      lastUsedAt: null,
      expiresAt: new Date(NOW.getTime() + 30 * DAY).toISOString(),
      revokedAt: null,
    });
    const [row] = await db.select().from(mcpTokens);
    expect(row).toMatchObject({
      ownerUserId: admin.user.id,
      tokenHash: sha256Hex(issued.token),
      tokenPrefix: issued.token.slice(0, 11),
    });
    expect(JSON.stringify(row)).not.toContain(issued.token);
    const [entry] = await audits('mcp_token.issue');
    expect(entry).toMatchObject({
      entityType: 'mcp_token',
      entityId: row?.id,
      actorUserId: admin.user.id,
      after: { name: 'Claude Desktop', scope: 'read', prefix: issued.token.slice(0, 11) },
    });
    expect(JSON.stringify(entry)).not.toContain(issued.token);
  });

  it('validates the token input with pt-BR messages', async () => {
    const admin = await createStaff(db, 'admin', NOW);

    const noName = await call(admin.cookie, 'POST', '/admin/integrations/mcp/tokens', {
      name: '',
      scope: 'read',
    });
    const tooLong = await call(admin.cookie, 'POST', '/admin/integrations/mcp/tokens', {
      name: 'Celular',
      scope: 'read_write',
      expiresInDays: 366,
    });

    expect(noName.status).toBe(422);
    expect(noName.error?.details?.[0]).toEqual({
      path: 'name',
      message: 'Informe um nome para o token',
    });
    expect(tooLong.status).toBe(422);
    expect(tooLong.error?.details?.[0]?.path).toBe('expiresInDays');
    expect(await db.select().from(mcpTokens)).toHaveLength(0);
  });

  it('lists tokens without the raw value and revokes with audit', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const issued = await issue(admin.cookie);

    const revoked = await call(
      admin.cookie,
      'DELETE',
      `/admin/integrations/mcp/tokens/${issued.record.id}`,
    );
    const again = await call(
      admin.cookie,
      'DELETE',
      `/admin/integrations/mcp/tokens/${issued.record.id}`,
    );
    const listed = await call(admin.cookie, 'GET', '/admin/integrations/mcp');

    expect(revoked.status).toBe(204);
    expect(again.status).toBe(404);
    const body = listed.body as { tokens: { id: string; revokedAt: string | null }[] };
    expect(body.tokens).toEqual([
      expect.objectContaining({ id: issued.record.id, revokedAt: NOW.toISOString() }),
    ]);
    expect(JSON.stringify(listed.body)).not.toContain(issued.token);
    expect(JSON.stringify(listed.body)).not.toContain(sha256Hex(issued.token));
    const [entry] = await audits('mcp_token.revoke');
    expect(entry).toMatchObject({ entityId: issued.record.id, actorUserId: admin.user.id });
  });
});

describe('GET/PUT /admin/integrations/mcp (GES-63, GES-120)', () => {
  it('uses API_FUNCTION_URL for the server URL and warns when it is unset', async () => {
    const admin = await createStaff(db, 'admin', NOW);

    const native = await call(
      admin.cookie,
      'GET',
      '/admin/integrations/mcp',
      undefined,
      buildApp({ env: { API_FUNCTION_URL: 'https://api-fn.example.neon.tech/' } }),
    );
    const proxied = await call(admin.cookie, 'GET', '/admin/integrations/mcp');

    expect(native.body).toMatchObject({
      enabled: false,
      serverUrl: 'https://api-fn.example.neon.tech/mcp',
      serverUrlWarning: null,
      tools: [
        {
          name: 'echo_test',
          description: 'Devolve o texto recebido.',
          scope: 'read',
          destructive: false,
        },
      ],
      tokens: [],
    });
    expect(proxied.body).toMatchObject({ serverUrl: 'http://localhost:5173/api/mcp' });
    expect((proxied.body as { serverUrlWarning: string }).serverUrlWarning).toContain('26 s');
  });

  it('turns the server on with audit; reception gets 403 on token creation and the tab', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const reception = await createStaff(db, 'reception', NOW);

    const saved = await call(admin.cookie, 'PUT', '/admin/integrations/mcp', { enabled: true });
    const create = await call(reception.cookie, 'POST', '/admin/integrations/mcp/tokens', {
      name: 'Recepção',
      scope: 'read',
    });
    const tab = await call(reception.cookie, 'GET', '/admin/integrations/mcp');

    expect(saved.status).toBe(200);
    expect((await loadSettings(db))['mcp.enabled']).toBe(true);
    const [entry] = await audits('integration.mcp_update');
    expect(entry).toMatchObject({ before: { enabled: false }, after: { enabled: true } });
    expect([create.status, create.error?.code]).toEqual([403, 'FORBIDDEN']);
    expect([tab.status, tab.error?.code]).toEqual([403, 'FORBIDDEN']);
    expect(await db.select().from(mcpTokens)).toHaveLength(0);
  });
});

describe('/mcp transport guards (GES-55, GES-56, GES-60, GES-64)', () => {
  it('answers 404 FEATURE_DISABLED while mcp.enabled is false', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const { token } = await issue(admin.cookie);

    const res = await rawMcpRequest(buildApp(), `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('FEATURE_DISABLED');
  });

  it('answers 401 for a missing, malformed, unknown, revoked or expired token and a demoted owner', async () => {
    await enableMcp();
    const admin = await createStaff(db, 'admin', NOW);
    const other = await createStaff(db, 'admin', NOW);
    const revoked = await issue(admin.cookie);
    await call(admin.cookie, 'DELETE', `/admin/integrations/mcp/tokens/${revoked.record.id}`);
    const expiring = await issue(admin.cookie, { expiresInDays: 1 });
    const demoted = await issue(other.cookie);
    await db.update(users).set({ role: 'reception' }).where(eq(users.id, other.user.id));
    const valid = await issue(admin.cookie);
    const later = buildApp({ now: new Date(NOW.getTime() + DAY) });

    const statuses = [
      (await rawMcpRequest(buildApp())).status,
      (await rawMcpRequest(buildApp(), 'Bearer nope')).status,
      (await rawMcpRequest(buildApp(), `Bearer bmcp_${'x'.repeat(43)}`)).status,
      (await rawMcpRequest(buildApp(), `Bearer ${revoked.token}`)).status,
      (await rawMcpRequest(later, `Bearer ${expiring.token}`)).status,
      (await rawMcpRequest(buildApp(), `Bearer ${demoted.token}`)).status,
    ];
    const missing = await rawMcpRequest(buildApp());
    const ok = await rawMcpRequest(buildApp(), `Bearer ${valid.token}`);

    expect(statuses).toEqual([401, 401, 401, 401, 401, 401]);
    expect(((await missing.json()) as { error: { code: string } }).error.code).toBe(
      'UNAUTHENTICATED',
    );
    expect(missing.headers.get('WWW-Authenticate')).toBe('Bearer');
    expect(ok.status).toBe(200);
  });

  it('answers 429 with Retry-After once a token exceeds mcp.rate_limit_per_minute', async () => {
    await enableMcp();
    await withTransaction(db, (tx) => saveSetting(tx, 'mcp.rate_limit_per_minute', 3, null));
    const admin = await createStaff(db, 'admin', NOW);
    const { token, record } = await issue(admin.cookie);
    // NOW is on the minute; two requests already happened in it.
    await db.insert(rateLimitBuckets).values({
      key: mcpRateLimitKey(record.id),
      windowStart: NOW,
      count: 2,
    });

    const third = await rawMcpRequest(buildApp(), `Bearer ${token}`);
    const fourth = await rawMcpRequest(buildApp(), `Bearer ${token}`);

    expect(third.status).toBe(200);
    expect(fourth.status).toBe(429);
    expect(((await fourth.json()) as { error: { code: string } }).error.code).toBe(
      'TOO_MANY_ATTEMPTS',
    );
    expect(fourth.headers.get('Retry-After')).toBe('60');
  });

  it('records last_used_at at most once per minute', async () => {
    await enableMcp();
    const admin = await createStaff(db, 'admin', NOW);
    const { token, record } = await issue(admin.cookie);
    const lastUsed = async () =>
      (await db.select().from(mcpTokens).where(eq(mcpTokens.id, record.id)))[0]?.lastUsedAt;

    await rawMcpRequest(buildApp(), `Bearer ${token}`);
    const first = await lastUsed();
    await rawMcpRequest(buildApp({ now: new Date(NOW.getTime() + 30_000) }), `Bearer ${token}`);
    const within = await lastUsed();
    await rawMcpRequest(buildApp({ now: new Date(NOW.getTime() + 61_000) }), `Bearer ${token}`);
    const after = await lastUsed();

    expect(first?.toISOString()).toBe(NOW.toISOString());
    expect(within?.toISOString()).toBe(NOW.toISOString());
    expect(after?.toISOString()).toBe(new Date(NOW.getTime() + 61_000).toISOString());
  });
});

describe('tool calls through the SDK client (GES-61)', () => {
  it('runs a tool and writes one audit row with origin mcp, action mcp.<tool>, the token as entity', async () => {
    await enableMcp();
    const admin = await createStaff(db, 'admin', NOW);
    const { token, record } = await issue(admin.cookie);
    const client = await connectMcp(buildApp(), token);

    const listed = await client.listTools();
    const result = await client.callTool({ name: 'echo_test', arguments: { text: 'olá' } });
    await client.close();

    expect(listed.tools.map((t) => t.name)).toEqual(['echo_test']);
    expect(listed.tools[0]?.inputSchema).toMatchObject({
      type: 'object',
      properties: { text: { type: 'string' } },
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ echoed: 'olá' });
    const rows = await audits('mcp.echo_test');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      origin: 'mcp',
      actorUserId: admin.user.id,
      actorRole: 'admin',
      entityType: 'mcp_token',
      entityId: record.id,
      after: { arguments: { text: 'olá' }, ok: true },
    });
  });
});
