import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';
import { pwaOptions } from './pwa.config';
import { resolveSiteUrl } from './site-url';

// The API runs locally on :8787 and serves routes without the `/api` prefix (AD-015),
// so the dev proxy strips it. In production Netlify redirects `/api/*` to the function.
// DEV_API_ORIGIN points the dev and preview proxy at another local API (a parallel e2e run).
export default defineConfig(({ mode, isSsrBuild }) => {
  // Vite replaces `%VITE_SITE_URL%` in index.html from its loaded env. Fill in the default
  // when neither the environment nor a .env file provides one (config is read before env).
  process.env['VITE_SITE_URL'] = resolveSiteUrl(
    loadEnv(mode, process.cwd(), 'VITE_')['VITE_SITE_URL'],
  );

  return {
    // The prerender bundle (scripts/prerender.mjs, GES-143) runs in Node: no service worker.
    plugins: [react(), ...(isSsrBuild ? [] : [VitePWA(pwaOptions)])],
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: process.env['DEV_API_ORIGIN'] ?? 'http://localhost:8787',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
      },
    },
    test: {
      environment: 'jsdom',
      include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.mjs'],
      setupFiles: ['./src/test/setup.ts'],
      // Page tests mount real trees with MSW; a loaded CI or dev machine needs more than 5 s.
      testTimeout: 15000,
      css: false,
    },
  };
});
