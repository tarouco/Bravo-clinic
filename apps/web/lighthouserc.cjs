// Lighthouse CI budgets of the public pages (GES-143): mobile preset, three runs per URL, the
// median run asserted.
//
// The budget is measured against a deploy: build with the production env (API_PROXY_ORIGIN,
// VITE_SITE_URL, STORAGE_PUBLIC_ORIGIN), publish a Netlify draft deploy (`netlify deploy
// --no-build`, never --prod) and run `LHCI_URL_BASE=<draft url> npx lhci autorun` in apps/web, so
// the real CDN, compression, `_redirects`, headers and API answer. No local server starts then.
//
// Without LHCI_URL_BASE, `npm run lhci -w apps/web` builds and prerenders the app and serves
// `dist` with scripts/preview-compressed.mjs (brotli/gzip, the netlify.toml cache headers and
// Netlify's `.html` lookup; `/api` proxied to DEV_API_ORIGIN or :8787): a quick local check whose
// numbers depend on the local API and host. Run either once with the analytics env unset and
// once with VITE_ANALYTICS_PROVIDER and its key set.
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
