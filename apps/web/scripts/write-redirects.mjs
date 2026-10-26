import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

// `_redirects` cannot read environment variables and the function URL differs per Neon branch
// (AD-016), so the file is generated at build time from API_PROXY_ORIGIN (and, when room photos
// are served from object storage, STORAGE_PUBLIC_ORIGIN; AD-026).

function httpsOrigin(origin, name) {
  const base = typeof origin === 'string' ? origin.replace(/\/+$/, '') : '';
  if (!base.startsWith('https://')) {
    throw new Error(`${name} must be an https URL`);
  }
  return base;
}

/**
 * The Netlify `_redirects` file: the `/api/*` proxy to the Neon function first, then the
 * same-origin `/media/*` proxy to the public `room-photos` bucket when `storageOrigin` is given
 * (GES-108), then the SPA fallback. Netlify uses the first matching rule, so the order is part of
 * the contract. A missing or empty `storageOrigin` leaves the media rule out; a set but non-https
 * one is an error.
 */
export function buildRedirects(origin, storageOrigin) {
  const base = httpsOrigin(origin, 'API_PROXY_ORIGIN');
  const rules = [`/api/*  ${base}/:splat  200`];
  if (typeof storageOrigin === 'string' && storageOrigin !== '') {
    const storage = httpsOrigin(storageOrigin, 'STORAGE_PUBLIC_ORIGIN');
    rules.push(`/media/*  ${storage}/room-photos/:splat  200`);
  }
  rules.push('/*  /index.html  200');
  return `${rules.join('\n')}\n`;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  try {
    const content = buildRedirects(process.env.API_PROXY_ORIGIN, process.env.STORAGE_PUBLIC_ORIGIN);
    writeFileSync(fileURLToPath(new URL('../dist/_redirects', import.meta.url)), content);
  } catch (error) {
    console.error(`write-redirects: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
