import { notificationEventsSchema } from '@bravo/core';
import { z } from 'zod';

// Response shapes of the gestao Integrações routes (gestao design "Gateway configuration",
// "Notification admin", "MCP server" and "ICS serializer and feeds"). Core owns the request
// schemas; the response contracts are declared here so the MSW fixtures are validated against
// them (AD-035). The fields the design leaves open are listed in the design's "Web-assumed API
// contract" section.

// ---- Pagamentos (GES-35..GES-41) ----

export const gatewayEnvironmentSchema = z.enum(['test', 'production']);

export const gatewayFieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  /** Secret fields are write-only: the API never returns their value, only `secretHint`. */
  secret: z.boolean(),
});

export const gatewayAdapterSchema = z.object({
  provider: z.string().min(1),
  label: z.string().min(1),
  fields: z.array(gatewayFieldSchema),
  configured: z.boolean(),
  enabled: z.boolean(),
  environment: gatewayEnvironmentSchema.nullable(),
  /** `••••` plus the last 4 characters of the stored secret; null while none is stored. */
  secretHint: z.string().nullable(),
  /** Current values of the non-secret fields, keyed by field key. */
  config: z.record(z.string(), z.string()),
  webhookUrl: z.string().min(1),
});
export type GatewayAdapter = z.infer<typeof gatewayAdapterSchema>;

export const gatewayOverviewSchema = z.object({
  activeProvider: z.string().min(1),
  /** True in production while the active gateway is the sandbox or in test mode (GES-41). */
  productionWarning: z.boolean(),
  adapters: z.array(gatewayAdapterSchema),
});
export type GatewayOverview = z.infer<typeof gatewayOverviewSchema>;

export const gatewayTestResultSchema = z.object({ ok: z.boolean(), message: z.string() });
export type GatewayTestResult = z.infer<typeof gatewayTestResultSchema>;

// ---- Calendário (GES-42, GES-43) ----

export const calendarFeedSchema = z.object({
  id: z.string().min(1),
  scope: z.enum(['clinic', 'room']),
  roomId: z.string().nullable(),
  roomName: z.string().nullable(),
  /** First 6 characters of the token; the token itself is shown only when issued. */
  prefix: z.string().min(1),
  createdAt: z.string().min(1),
});
export type CalendarFeed = z.infer<typeof calendarFeedSchema>;

/** Active feeds (revoked ones are not listed) and the rooms a room feed can be issued for. */
export const calendarOverviewSchema = z.object({
  feeds: z.array(calendarFeedSchema),
  rooms: z.array(z.object({ id: z.string().min(1), name: z.string().min(1) })),
});
export type CalendarOverview = z.infer<typeof calendarOverviewSchema>;

/** `POST .../calendar/feeds` (201): the only time the full URL is returned. */
export const feedIssuedSchema = z.object({ url: z.string().min(1), prefix: z.string().min(1) });
export type FeedIssued = z.infer<typeof feedIssuedSchema>;

// ---- E-mails (GES-65..GES-74) ----

export const outboxStatusSchema = z.enum(['pending', 'sent', 'failed', 'not_sent']);
export type OutboxStatus = z.infer<typeof outboxStatusSchema>;

export const emailRecipientSchema = z.object({
  id: z.string().min(1),
  email: z.string().min(1),
  active: z.boolean(),
});
export type EmailRecipient = z.infer<typeof emailRecipientSchema>;

export const notificationsOverviewSchema = z.object({
  /** False while `RESEND_API_KEY` is absent (GES-74). */
  providerConfigured: z.boolean(),
  recipients: z.array(emailRecipientSchema),
  events: notificationEventsSchema,
});
export type NotificationsOverview = z.infer<typeof notificationsOverviewSchema>;

export const testEmailResultSchema = z.object({
  results: z.array(z.object({ to: z.string().min(1), status: outboxStatusSchema })),
});
export type TestEmailResult = z.infer<typeof testEmailResultSchema>;

export const outboxRowSchema = z.object({
  id: z.string().min(1),
  to: z.string().min(1),
  template: z.string().min(1),
  subject: z.string(),
  status: outboxStatusSchema,
  attempts: z.number().int().min(0),
  lastError: z.string().nullable(),
  createdAt: z.string().min(1),
  sentAt: z.string().nullable(),
});
export type OutboxRow = z.infer<typeof outboxRowSchema>;

export const outboxPageSchema = z.object({
  items: z.array(outboxRowSchema),
  nextCursor: z.string().nullable(),
});
export type OutboxPage = z.infer<typeof outboxPageSchema>;

// ---- MCP (GES-53, GES-54, GES-63) ----

export const mcpToolSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  /** `write` tools need a token with the `read_write` scope. */
  scope: z.enum(['read', 'write']),
  /** Destructive tools refuse to run without `confirm: true` (GES-59). */
  destructive: z.boolean(),
});
export type McpTool = z.infer<typeof mcpToolSchema>;

/** A token as listed: never the raw secret (GES-54). */
export const mcpTokenViewSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  scope: z.enum(['read', 'read_write']),
  prefix: z.string().min(1),
  createdAt: z.string().min(1),
  lastUsedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
});
export type McpTokenRecord = z.infer<typeof mcpTokenViewSchema>;

export const mcpOverviewSchema = z.object({
  enabled: z.boolean(),
  serverUrl: z.string().min(1),
  /** Set when the URL goes through the Netlify proxy, which cuts long requests (design risks). */
  serverUrlWarning: z.string().nullable(),
  tools: z.array(mcpToolSchema),
  tokens: z.array(mcpTokenViewSchema),
});
export type McpOverview = z.infer<typeof mcpOverviewSchema>;

/** `POST .../mcp/tokens` (201): the raw `bmcp_...` token appears only here. */
export const mcpTokenIssuedSchema = z.object({
  token: z.string().min(1),
  record: mcpTokenViewSchema,
});
export type McpTokenIssued = z.infer<typeof mcpTokenIssuedSchema>;

// ---- Consumo (GES-137..GES-139) ----

const bytes = z.number().int().min(0);

export const usageReportSchema = z.object({
  db: z.object({
    bytes,
    limitBytes: bytes,
    /** 0..100, one decimal. */
    percent: z.number().min(0),
    warning: z.boolean(),
  }),
  storage: z.object({
    buckets: z.object({ 'room-photos': bytes, 'expense-attachments': bytes }).nullable(),
    bytes: bytes.nullable(),
    limitBytes: bytes,
    percent: z.number().min(0).nullable(),
    warning: z.boolean(),
    /** Set when listing the buckets failed; the other figures are still valid (GES-139). */
    storageError: z.string().optional(),
  }),
  emails: z.object({
    month: bytes,
    monthLimit: bytes,
    today: bytes,
    dayLimit: bytes,
    warning: z.boolean(),
  }),
  largestTables: z.array(
    z.object({ name: z.string().min(1), totalBytes: bytes, estimatedRows: bytes }),
  ),
});
export type UsageReport = z.infer<typeof usageReportSchema>;
