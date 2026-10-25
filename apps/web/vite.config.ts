import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';
import { pwaOptions } from './pwa.config';

/** Canonical URL used by `index.html` (Open Graph, JSON-LD) when `VITE_SITE_URL` is not set. */
const DEFAULT_SITE_URL = 'https://bravo-clinic.netlify.app';

// The API runs locally on :8787 and serves routes without the `/api` prefix (AD-015),
// so the dev proxy strips it. In production Netlify redirects `/api/*` to the function.
export default defineConfig(({ mode }) => {
  // Vite replaces `%VITE_SITE_URL%` in index.html from its loaded env; fill the default
  // (without a trailing slash) when neither the environment nor a .env file provides one.
  const siteUrl = loadEnv(mode, process.cwd(), 'VITE_')['VITE_SITE_URL'] || DEFAULT_SITE_URL;
  process.env['VITE_SITE_URL'] = siteUrl.replace(/\/+$/, '');

  return {
    plugins: [react(), VitePWA(pwaOptions)],
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: 'http://localhost:8787',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
      },
    },
    test: {
      environment: 'jsdom',
      include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.mjs'],
      setupFiles: ['./src/test/setup.ts'],
      css: false,
    },
  };
});
