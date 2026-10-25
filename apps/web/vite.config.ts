import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// The API runs locally on :8787 and serves routes without the `/api` prefix (AD-015),
// so the dev proxy strips it. In production Netlify redirects `/api/*` to the function.
export default defineConfig({
  plugins: [react()],
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
    // T38 ships no tests; T39 removes this flag once the first test file exists.
    passWithNoTests: true,
  },
});
