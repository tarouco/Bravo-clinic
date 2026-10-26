import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

// Integration tests run against DATABASE_URL_TEST (Neon `dev` locally, postgres:17 in CI).
// The root .env also holds the production DATABASE_URL, so the API under test must never see it.
const rootDir = fileURLToPath(new URL('../..', import.meta.url));
const rootEnv = loadEnv('test', rootDir, '');
const testDatabaseUrl = rootEnv.DATABASE_URL_TEST ?? process.env.DATABASE_URL_TEST ?? '';

export default defineConfig({
  test: {
    environment: 'node',
    // Integration tests seed and query a remote Neon branch; round trips take tens of milliseconds.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    include: ['src/**/*.test.ts'],
    globalSetup: ['./test/global-setup.ts'],
    setupFiles: ['./test/setup.ts'],
    fileParallelism: false,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    env: {
      DATABASE_URL_TEST: testDatabaseUrl,
      DATABASE_URL: testDatabaseUrl,
      SESSION_SECRET: 'test-only-session-secret-0123456789abcdef',
      ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
      APP_BASE_URL: 'http://localhost:5173',
      EMAIL_FROM: 'no-reply@bravoclinic.test',
    },
  },
});
