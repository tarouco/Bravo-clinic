import { defineConfig, devices } from '@playwright/test';

// Núcleo end-to-end suite (T49): the real API on :8787 over DATABASE_URL_TEST (reset, migrated and
// seeded by apps/api/test/e2e-seed.ts) behind the Vite preview proxy on :5173, sandbox gateway.
// Specs share one database, so they run serially; each project books its own dates and rooms.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env['CI']),
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // The installed Google Chrome (Chromium) runs headless; no browser download is needed.
    channel: 'chrome',
    // The PWA service worker of the build would sit between the specs and the network.
    serviceWorkers: 'block',
  },
  projects: [
    { name: 'desktop', testIgnore: /mvp-journey\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
    {
      name: 'mobile',
      // The admin configuration journey (GES-141) runs once, on desktop.
      testIgnore: /(mvp-journey|admin-config)\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 375, height: 812 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      // The MVP journey (GES-140) on the 390×844 phone of the spec.
      name: 'journey',
      testMatch: /mvp-journey\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: [
    {
      command: 'npx tsx test/e2e-seed.ts',
      cwd: '../api',
      url: 'http://localhost:8787/health',
      reuseExistingServer: false,
      timeout: 300_000,
      stdout: 'pipe',
    },
    {
      // A production build behind `vite preview` (same /api proxy as dev): the dev server's
      // on-demand dependency optimisation reloads pages mid-test.
      command: 'npx vite build && npx vite preview --port 5173 --strictPort',
      url: 'http://localhost:5173',
      reuseExistingServer: false,
      timeout: 300_000,
    },
  ],
});
