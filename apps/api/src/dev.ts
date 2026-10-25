import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';

// Local dev only. The root .env holds the production DATABASE_URL, so the dev server runs against
// the Neon `dev` branch (DATABASE_URL_TEST) whenever it is configured.
const envFile = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);
if (process.env.DATABASE_URL_TEST) process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;

const { default: app } = await import('./index');
const port = 8787;

serve({ fetch: app.fetch, port }, () => {
  process.stdout.write(`api listening on http://localhost:${port}\n`);
});
