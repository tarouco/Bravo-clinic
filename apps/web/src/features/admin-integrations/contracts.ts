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
