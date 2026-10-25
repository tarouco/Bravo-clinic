import { defineConfig } from '@neon/config/v1';

// Function secrets are read from process.env at deploy time (`neon deploy --env <file>`).
// Optional keys are spread only when set: sending "" would delete a live key.
const optional = (key: string): Record<string, string> => {
  const value = process.env[key];
  return value ? { [key]: value } : {};
};

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
  // triggers: added by nucleo (every 5 min) and receita/gestao (daily) per AD-007, all `type: 'schedule'`,
  // `function: 'api'`, `functionPath: '/jobs/<name>'`.
  // buckets: added by gestao (room photos, expense attachments) per AD-009.
});
