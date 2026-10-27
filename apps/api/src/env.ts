import { z } from 'zod';

const isThirtyTwoByteBase64 = (value: string): boolean => {
  const bytes = Buffer.from(value, 'base64');
  return bytes.length === 32 && bytes.toString('base64') === value;
};

export const envSchema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  DATABASE_URL_UNPOOLED: z.url({ protocol: /^postgres(ql)?$/ }).optional(),
  NEON_BRANCH: z.string().min(1).optional(),
  SESSION_SECRET: z.string().min(32),
  ENCRYPTION_KEY: z.string().refine(isThirtyTwoByteBase64),
  APP_BASE_URL: z.url({ protocol: /^https?$/ }),
  EMAIL_FROM: z.email(),
  RESEND_API_KEY: z.string().min(1).optional(),
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  // Object storage, injected by Neon when neon.ts declares buckets (AD-026).
  AWS_ACCESS_KEY_ID: z.string().min(1).optional(),
  AWS_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  AWS_ENDPOINT_URL_S3: z.url({ protocol: /^https?$/ }).optional(),
  AWS_REGION: z.string().min(1).optional(),
  // Web push (GES-75..GES-81); push is off unless all three are set.
  VAPID_PUBLIC_KEY: z.string().min(1).optional(),
  VAPID_PRIVATE_KEY: z.string().min(1).optional(),
  VAPID_SUBJECT: z.string().min(1).optional(),
  // Native URL of the API function; MCP clients use `${API_FUNCTION_URL}/mcp` (AD-028, GES-63).
  API_FUNCTION_URL: z.url({ protocol: /^https?$/ }).optional(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type Env = z.infer<typeof envSchema>;

/** Lists the offending variable names only; values never reach the message. */
export class EnvError extends Error {
  readonly variables: string[];

  constructor(variables: string[]) {
    super(`Invalid environment variables: ${variables.join(', ')}`);
    this.name = 'EnvError';
    this.variables = variables;
  }
}

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (result.success) return result.data;
  const variables = [...new Set(result.error.issues.map((issue) => String(issue.path[0])))];
  throw new EnvError(variables);
}

let cached: Env | undefined;

export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
