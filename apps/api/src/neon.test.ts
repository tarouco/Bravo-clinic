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
  'API_FUNCTION_URL',
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

async function loadTriggers() {
  vi.resetModules();
  const { default: config } = await import('../../../neon');
  return config.triggers ?? {};
}

describe('neon.ts', () => {
  it('declares the nucleo (NUC-199) and receita (REC-59) schedule triggers of the jobs routes', async () => {
    const every5 = (name: string) => ({
      type: 'schedule',
      function: 'api',
      cron: '*/5 * * * *',
      functionPath: `/jobs/${name}`,
    });
    const daily = (name: string) => ({
      type: 'schedule',
      function: 'api',
      cron: '0 6 * * *',
      functionPath: `/jobs/${name}`,
    });

    expect(await loadTriggers()).toEqual({
      'expire-holds': every5('expire-holds'),
      'charge-balances': every5('charge-balances'),
      reminders: every5('reminders'),
      'no-shows': every5('no-shows'),
      'reconcile-payments': every5('reconcile-payments'),
      'materialize-blocks': {
        type: 'schedule',
        function: 'api',
        cron: '0 8 * * *',
        functionPath: '/jobs/materialize-blocks',
      },
      renewals: daily('renewals'),
      'period-rollover': daily('period-rollover'),
      suspensions: daily('suspensions'),
      'expire-purchases': every5('expire-purchases'),
      'email-retry': every5('email-retry'),
      retention: {
        type: 'schedule',
        function: 'api',
        cron: '0 8 * * 0',
        functionPath: '/jobs/retention',
      },
      'recurring-expenses': {
        type: 'schedule',
        function: 'api',
        cron: '0 9 * * *',
        functionPath: '/jobs/recurring-expenses',
      },
      'holiday-reminder': {
        type: 'schedule',
        function: 'api',
        cron: '0 11 * * *',
        functionPath: '/jobs/holiday-reminder',
      },
      'import-holidays': {
        type: 'schedule',
        function: 'api',
        cron: '0 7 * * 1',
        functionPath: '/jobs/import-holidays',
      },
    });
  });

  it('declares the public room-photos and private expense-attachments buckets (GES-144)', async () => {
    vi.resetModules();
    const { default: config } = await import('../../../neon');
    expect(config.buckets).toEqual({
      'room-photos': { access: 'public_read' },
      'expense-attachments': { access: 'private' },
    });
  });

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
