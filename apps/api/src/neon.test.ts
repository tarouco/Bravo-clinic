import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// neon.ts reads process.env when it is imported, so every test imports a fresh copy.
async function loadFunction() {
  vi.resetModules();
  const { default: config } = await import('../../../neon');
  const api = config.functions?.api;
  if (!api) throw new Error('neon.ts does not declare the api function');
  return api;
}

const OPTIONAL_KEYS = [
  'RESEND_API_KEY',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'VAPID_PUBLIC_KEY',
  'VAPID_PRIVATE_KEY',
  'VAPID_SUBJECT',
] as const;

beforeEach(() => {
  vi.stubEnv('SESSION_SECRET', 'stub-session-secret-0123456789abcdef');
  vi.stubEnv('ENCRYPTION_KEY', 'stub-encryption-key');
  vi.stubEnv('APP_BASE_URL', 'https://stub.example');
  vi.stubEnv('EMAIL_FROM', 'no-reply@stub.example');
  for (const key of OPTIONAL_KEYS) vi.stubEnv(key, undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('neon.ts', () => {
  it('declares the api function from apps/api/src/index.ts (FND-127)', async () => {
    const api = await loadFunction();
    expect(api.source).toBe('apps/api/src/index.ts');
  });

  it('passes the required values from process.env (FND-127)', async () => {
    const { env } = await loadFunction();
    expect(env).toEqual({
      SESSION_SECRET: 'stub-session-secret-0123456789abcdef',
      ENCRYPTION_KEY: 'stub-encryption-key',
      APP_BASE_URL: 'https://stub.example',
      EMAIL_FROM: 'no-reply@stub.example',
    });
  });

  it('omits every optional key that is unset or empty instead of sending "" (FND-127)', async () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', '');
    const { env } = await loadFunction();
    for (const key of OPTIONAL_KEYS) expect(env).not.toHaveProperty(key);
  });

  it('includes the optional keys that are set (FND-127)', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_stub');
    vi.stubEnv('GOOGLE_CLIENT_ID', 'google-id');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'google-secret');
    vi.stubEnv('VAPID_SUBJECT', 'mailto:ops@stub.example');
    const { env } = await loadFunction();
    expect(env).toMatchObject({
      RESEND_API_KEY: 're_stub',
      GOOGLE_CLIENT_ID: 'google-id',
      GOOGLE_CLIENT_SECRET: 'google-secret',
      VAPID_SUBJECT: 'mailto:ops@stub.example',
    });
    expect(env).not.toHaveProperty('VAPID_PUBLIC_KEY');
    expect(env).not.toHaveProperty('VAPID_PRIVATE_KEY');
  });
});
