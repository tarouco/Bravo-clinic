import { defineConfig } from '@neon/config/v1';

// Function secrets are read from process.env at deploy time (`neon deploy --env <file>`).
// Optional keys are spread only when set: sending "" would delete a live key.
const optional = (key: string): Record<string, string> => {
  const value = process.env[key];
  return value ? { [key]: value } : {};
};

const job = (cron: string, name: string) =>
  ({
    type: 'schedule',
    function: 'api',
    cron,
    functionPath: `/jobs/${name}`,
  }) as const;

export default defineConfig({
  functions: {
    api: {
      name: 'bravo api',
      source: 'apps/api/src/index.ts',
      env: {
        SESSION_SECRET: process.env['SESSION_SECRET']!,
        ENCRYPTION_KEY: process.env['ENCRYPTION_KEY']!,
        APP_BASE_URL: process.env['APP_BASE_URL']!,
        EMAIL_FROM: process.env['EMAIL_FROM']!,
        ...optional('RESEND_API_KEY'),
        ...optional('GOOGLE_CLIENT_ID'),
        ...optional('GOOGLE_CLIENT_SECRET'),
        ...optional('VAPID_PUBLIC_KEY'),
        ...optional('VAPID_PRIVATE_KEY'),
        ...optional('VAPID_SUBJECT'),
      },
    },
  },
  // Schedule triggers (AD-007): the nucleo jobs every 5 minutes, materialize-blocks daily at 05:00
  // BRT (08:00 UTC). receita and gestao add theirs here as `type: 'schedule'`, `function: 'api'`,
  // `functionPath: '/jobs/<name>'`. Each route authenticates with `parseTriggerDelivery`.
  triggers: {
    'expire-holds': job('*/5 * * * *', 'expire-holds'),
    'charge-balances': job('*/5 * * * *', 'charge-balances'),
    reminders: job('*/5 * * * *', 'reminders'),
    'no-shows': job('*/5 * * * *', 'no-shows'),
    'reconcile-payments': job('*/5 * * * *', 'reconcile-payments'),
    'materialize-blocks': job('0 8 * * *', 'materialize-blocks'),
    // receita: renewals, rollover and suspensions daily at 03:00 BRT (06:00 UTC), purchase holds
    // every 5 minutes. The daily three are order-independent (guarded transitions).
    renewals: job('0 6 * * *', 'renewals'),
    'period-rollover': job('0 6 * * *', 'period-rollover'),
    suspensions: job('0 6 * * *', 'suspensions'),
    'expire-purchases': job('*/5 * * * *', 'expire-purchases'),
  },
  // buckets: added by gestao (room photos, expense attachments) per AD-009.
});
