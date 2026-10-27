import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import { z, ZodError, type ZodType } from 'zod';
import type { AuthContext } from '../auth/session';
import { withTransaction } from '../db/client';
import { audit, type RequestContext } from '../lib/audit';
import { AppError, type ErrorDetails } from '../lib/errors';
import { logger } from '../lib/logger';
import type { AppDeps } from '../types';

// MCP server (AD-011, AD-028, GES-57..GES-62): stateless streamable HTTP, one server per request.
// Every tool goes through `defineTool`'s wrapper: scope check, input validation with the shared
// pt-BR schemas, `confirm: true` for destructive tools, one `mcp.<tool>` audit row per call and
// `AppError` → tool error `{ code, message, details }`.

/** What a tool's `preview` and `run` receive: the app's dependencies and the MCP actor. */
export interface ToolContext {
  deps: AppDeps;
  /** Audit context: actor = token owner, origin `mcp`. */
  ctx: RequestContext;
  owner: AuthContext;
  tokenId: string;
  now: Date;
}

export interface ToolSpec<S extends ZodType> {
  name: string;
  description: string;
  scope: 'read' | 'write';
  destructive?: boolean;
  input: S;
  /** pt-BR description of what a destructive call would do (GES-59). */
  preview?: (tc: ToolContext, input: z.output<S>) => Promise<string>;
  run: (tc: ToolContext, input: z.output<S>) => Promise<unknown>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  scope: 'read' | 'write';
  destructive: boolean;
  /** JSON Schema advertised by `tools/list`. */
  inputJsonSchema: Record<string, unknown>;
  call: (tc: ToolContext, args: Record<string, unknown>) => Promise<ToolOutcome>;
}

export type ToolOutcome =
  | { ok: true; result: unknown }
  | { ok: false; error: { code: string; message: string; details?: ErrorDetails } };

const toolError = (code: string, message: string, details?: ErrorDetails): ToolOutcome => ({
  ok: false,
  error: { code, message, ...(details !== undefined && { details }) },
});

function mergeAllOf(parts: Record<string, unknown>[]): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required = new Set<string>();
  for (const part of parts) {
    Object.assign(properties, (part['properties'] as Record<string, unknown> | undefined) ?? {});
    for (const key of (part['required'] as string[] | undefined) ?? []) required.add(key);
  }
  return { type: 'object', properties, required: [...required] };
}

function jsonSchemaOf(schema: ZodType, destructive: boolean): Record<string, unknown> {
  let json: Record<string, unknown>;
  try {
    json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' });
  } catch {
    json = { type: 'object' };
  }
  delete json['$schema'];
  // An intersection (`{ id }` & a core schema) becomes one object with both property sets.
  if (Array.isArray(json['allOf'])) json = mergeAllOf(json['allOf'] as Record<string, unknown>[]);
  if (json['type'] !== 'object') json = { type: 'object', properties: {} };
  if (destructive) {
    const properties = { ...((json['properties'] as Record<string, unknown> | undefined) ?? {}) };
    properties['confirm'] = {
      type: 'boolean',
      description: 'Envie true para confirmar a ação depois de ler a prévia.',
    };
    json = { ...json, properties };
  }
  return json;
}

/** Maps a thrown error to a tool error; unexpected errors are logged and reported as INTERNAL. */
export function errorOutcome(error: unknown, tool: string): ToolOutcome {
  if (error instanceof AppError) return toolError(error.code, error.message, error.details);
  if (error instanceof ZodError) {
    return toolError(
      'VALIDATION_FAILED',
      'Dados inválidos',
      error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message })),
    );
  }
  logger.error('mcp tool failed', {
    tool,
    error: { name: (error as Error).name, message: (error as Error).message },
  });
  return toolError('INTERNAL', 'Erro interno');
}

/** A tool of the catalog with the shared wrapper (gestao design "MCP server"). */
export function defineTool<S extends ZodType>(spec: ToolSpec<S>): ToolDefinition {
  const destructive = spec.destructive === true;
  return {
    name: spec.name,
    description: spec.description,
    scope: spec.scope,
    destructive,
    inputJsonSchema: jsonSchemaOf(spec.input, destructive),
    async call(tc, args) {
      const { confirm, ...rest } = args;
      const parsed = spec.input.safeParse(rest);
      if (!parsed.success) return errorOutcome(parsed.error, spec.name);
      try {
        if (destructive && confirm !== true) {
          const preview =
            spec.preview === undefined
              ? 'Esta ação não pode ser desfeita.'
              : await spec.preview(tc, parsed.data);
          return toolError('CONFIRMATION_REQUIRED', `Confirme enviando confirm: true. ${preview}`, {
            preview,
          });
        }
        return { ok: true, result: await spec.run(tc, parsed.data) };
      } catch (error) {
        return errorOutcome(error, spec.name);
      }
    },
  };
}

const asObject = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : { result: value ?? null };

function toCallResult(outcome: ToolOutcome): CallToolResult {
  if (outcome.ok) {
    const structured = asObject(outcome.result);
    return {
      content: [{ type: 'text', text: JSON.stringify(outcome.result ?? null) }],
      structuredContent: structured,
    };
  }
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: outcome.error }) }],
    structuredContent: { error: outcome.error },
    isError: true,
  };
}

/** Runs one tool call: scope check, the tool's wrapper, then the `mcp.<tool>` audit row (GES-61). */
export async function callTool(
  tools: ToolDefinition[],
  tc: ToolContext,
  scope: 'read' | 'read_write',
  name: string,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  const tool = tools.find((t) => t.name === name);
  let outcome: ToolOutcome;
  if (tool === undefined) {
    outcome = toolError('NOT_FOUND', 'Ferramenta não encontrada');
  } else if (tool.scope === 'write' && scope !== 'read_write') {
    outcome = toolError('FORBIDDEN', 'Este token só permite consultas.');
  } else {
    outcome = await tool.call(tc, args);
  }
  await withTransaction(tc.deps.db, (tx) =>
    audit(tx, tc.ctx, {
      action: `mcp.${name}`,
      entityType: 'mcp_token',
      entityId: tc.tokenId,
      after: {
        arguments: args,
        ok: outcome.ok,
        ...(!outcome.ok && { error: outcome.error.code }),
      },
    }),
  );
  return outcome;
}

/** The tools a token may see: read tools only for `read` tokens (GES-57). */
export function visibleTools(tools: ToolDefinition[], scope: 'read' | 'read_write') {
  return tools.filter((t) => scope === 'read_write' || t.scope === 'read');
}

/** Builds a fresh server for one request (stateless; no session affinity on the function). */
export function buildMcpServer(
  tools: ToolDefinition[],
  tc: ToolContext,
  scope: 'read' | 'read_write',
): McpServer {
  const server = new McpServer(
    { name: 'bravo-clinic', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );
  server.server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: visibleTools(tools, scope).map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputJsonSchema as { type: 'object'; [key: string]: unknown },
      annotations: {
        readOnlyHint: t.scope === 'read',
        destructiveHint: t.destructive,
      },
    })),
  }));
  server.server.setRequestHandler(CallToolRequestSchema, async (request) =>
    toCallResult(
      await callTool(tools, tc, scope, request.params.name, request.params.arguments ?? {}),
    ),
  );
  return server;
}

/** Answers one streamable-HTTP request (JSON responses, no SSE stream, no session). */
export async function handleMcpRequest(
  request: Request,
  tools: ToolDefinition[],
  tc: ToolContext,
  scope: 'read' | 'read_write',
): Promise<Response> {
  const server = buildMcpServer(tools, tc, scope);
  const transport = new WebStandardStreamableHTTPServerTransport({
    // No session id generator: stateless mode.
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    await server.close();
  }
}
