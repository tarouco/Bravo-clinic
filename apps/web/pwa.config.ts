import type { VitePWAOptions } from 'vite-plugin-pwa';

/**
 * PWA setup (FND-119..121). The app registers the service worker itself through
 * `useRegisterSW` (see `src/pwa/PwaUpdatePrompt.tsx`), so the plugin does not inject a script.
 */
export const pwaOptions: Partial<VitePWAOptions> = {
  registerType: 'prompt',
  injectRegister: false,
  manifest: {
    name: 'Bravô Clinic – Salas Inteligentes',
    short_name: 'Bravô',
    lang: 'pt-BR',
    start_url: '/app',
    scope: '/',
    display: 'standalone',
    background_color: '#f5eee6',
    theme_color: '#63391c',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      {
        src: '/icons/icon-512-maskable.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  },
  workbox: {
    globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff2}'],
    cleanupOutdatedCaches: true,
    // Web push handler (GES-82): public/push-sw.js runs inside the generated worker.
    importScripts: ['push-sw.js'],
    navigateFallback: '/index.html',
    // `/api/*` is served by the function behind the Netlify proxy, never by the SPA shell.
    navigateFallbackDenylist: [/^\/api\//],
    runtimeCaching: [
      {
        // Self-contained on purpose: Workbox serializes this function into `sw.js`.
        urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/api/'),
        handler: 'NetworkOnly',
      },
    ],
  },
};
