// Lighthouse CI budgets of the public pages (GES-143). `npm run lhci -w apps/web` builds the app,
// serves `dist` with scripts/preview-compressed.mjs (brotli/gzip and the netlify.toml cache
// headers, like Netlify; `/api` proxied to DEV_API_ORIGIN or :8787) and runs the mobile preset
// three times per URL; assertions use the median run. The API should be up (for example
// `npx tsx test/e2e-seed.ts` in apps/api) so the room pages render real data. Run it once with the
// analytics env unset and once with VITE_ANALYTICS_PROVIDER and its key set.
//
// LHCI_URL_BASE (for example a deploy preview URL) measures that site instead; no local server
// starts then.
const PORT = 5175;
const remote = (process.env.LHCI_URL_BASE ?? '').replace(/\/+$/, '');
const origin = remote || `http://localhost:${PORT}`;

module.exports = {
  ci: {
    collect: {
      ...(remote
        ? {}
        : {
            startServerCommand: `node scripts/preview-compressed.mjs`,
            startServerReadyPattern: 'Local',
          }),
      url: ['/', '/salas', '/salas/principal'].map((path) => `${origin}${path}`),
      numberOfRuns: 3,
      // Lighthouse's default config is the mobile preset: Moto G-class emulation, slow 4G
      // simulated throttling. Storage is reset per run, so the PWA worker never serves a run.
      settings: {
        onlyCategories: ['performance', 'accessibility'],
        chromeFlags: '--headless=new --no-sandbox',
      },
    },
    assert: {
      aggregationMethod: 'median-run',
      assertions: {
        'largest-contentful-paint': ['error', { maxNumericValue: 2500 }],
        'cumulative-layout-shift': ['error', { maxNumericValue: 0.1 }],
        'categories:accessibility': ['error', { minScore: 0.95 }],
      },
    },
    upload: { target: 'filesystem', outputDir: '.lighthouseci/reports' },
  },
};
