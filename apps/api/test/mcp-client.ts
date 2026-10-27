import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Hono } from 'hono';
import type { AppEnv } from '../src/types';

/** An SDK client connected to the app's `/mcp` route in-process (no network). */
export async function connectMcp(app: Hono<AppEnv>, token: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL('http://localhost/mcp'), {
    fetch: async (url, init) => app.request(url instanceof URL ? url.toString() : url, init),
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: 'bravo-test', version: '1.0.0' });
  await client.connect(transport);
  return client;
}

/** The structured error a tool call returned (`isError: true`). */
export function toolErrorOf(result: unknown): { code: string; message: string; details?: unknown } {
  const structured = (result as { structuredContent?: { error?: unknown } }).structuredContent;
  return structured?.error as { code: string; message: string; details?: unknown };
}

/** A raw JSON-RPC POST to `/mcp`, for the HTTP-level checks (404/401/429). */
export function rawMcpRequest(app: Hono<AppEnv>, authorization?: string) {
  return app.request('/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(authorization !== undefined && { Authorization: authorization }),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'raw', version: '1.0.0' },
      },
    }),
  });
}
