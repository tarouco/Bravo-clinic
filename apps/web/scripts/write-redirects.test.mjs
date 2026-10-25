import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildRedirects } from './write-redirects.mjs';

const MESSAGE = 'API_PROXY_ORIGIN must be an https URL';
// Vitest runs with the workspace (apps/web) as cwd.
const scriptPath = resolve(process.cwd(), 'scripts/write-redirects.mjs');
const lines = (text) => text.split('\n').filter((line) => line !== '');

describe('buildRedirects', () => {
  it('proxies /api/* to the origin first, stripping a trailing slash (FND-125)', () => {
    const rules = lines(buildRedirects('https://br-x-api.compute.neon.tech/'));
    expect(rules[0]).toBe('/api/*  https://br-x-api.compute.neon.tech/:splat  200');
  });

  it('ends with the SPA fallback and holds exactly the two rules (FND-125)', () => {
    const rules = lines(buildRedirects('https://br-x-api.compute.neon.tech/'));
    expect(rules.at(-1)).toBe('/*  /index.html  200');
    expect(rules).toHaveLength(2);
  });

  it('produces the same file with and without trailing slashes', () => {
    const bare = buildRedirects('https://br-x-api.compute.neon.tech');
    expect(buildRedirects('https://br-x-api.compute.neon.tech/')).toBe(bare);
    expect(buildRedirects('https://br-x-api.compute.neon.tech//')).toBe(bare);
  });

  it('throws when the origin is missing (FND-126)', () => {
    expect(() => buildRedirects(undefined)).toThrow(MESSAGE);
    expect(() => buildRedirects('')).toThrow(MESSAGE);
  });

  it('throws when the origin is not https (FND-126)', () => {
    expect(() => buildRedirects('http://x')).toThrow(MESSAGE);
    expect(() => buildRedirects('https://')).toThrow(MESSAGE);
  });
});

describe('write-redirects CLI', () => {
  it('exits non-zero with the message when API_PROXY_ORIGIN is unset (FND-126)', () => {
    const env = { ...process.env };
    delete env.API_PROXY_ORIGIN;
    const result = spawnSync(process.execPath, [scriptPath], { env, encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(MESSAGE);
  });
});
