import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

// `_redirects` cannot read environment variables and the function URL differs per Neon branch
// (AD-016), so the file is generated at build time from API_PROXY_ORIGIN.

/**
 * The Netlify `_redirects` file: the `/api/*` proxy to the Neon function first, then the SPA
 * fallback. Netlify uses the first matching rule, so the order is part of the contract.
 */
export function buildRedirects(origin) {
  const base = typeof origin === 'string' ? origin.replace(/\/+$/, '') : '';
  if (!base.startsWith('https://')) {
    throw new Error('API_PROXY_ORIGIN must be an https URL');
  }
  return `/api/*  ${base}/:splat  200\n/*  /index.html  200\n`;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  try {
    const content = buildRedirects(process.env.API_PROXY_ORIGIN);
    writeFileSync(fileURLToPath(new URL('../dist/_redirects', import.meta.url)), content);
  } catch (error) {
    console.error(`write-redirects: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
