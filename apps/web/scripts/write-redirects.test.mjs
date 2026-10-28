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

  it('serves / from the prerendered home.html, forced, just before the SPA fallback (GES-143)', () => {
    const rules = lines(
      buildRedirects('https://br-x-api.compute.neon.tech', 'https://s.example', {
        prerenderedHome: true,
      }),
    );
    expect(rules).toEqual([
      '/api/*  https://br-x-api.compute.neon.tech/:splat  200',
      '/media/*  https://s.example/room-photos/:splat  200',
      '/  /home.html  200!',
      '/*  /index.html  200',
    ]);
  });

  it('leaves the home rule out unless home.html was prerendered', () => {
    const rules = lines(buildRedirects('https://br-x-api.compute.neon.tech', undefined, {}));
    expect(rules).not.toContain('/  /home.html  200!');
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

const STORAGE_MESSAGE = 'STORAGE_PUBLIC_ORIGIN must be an https URL';
const API = 'https://br-x-api.compute.neon.tech';

describe('buildRedirects /media/* rule (GES-108, AD-026)', () => {
  it('emits the room-photos proxy after /api/* and before the SPA fallback when the storage origin is set', () => {
    const rules = lines(buildRedirects(API, 'https://x'));
    expect(rules).toEqual([
      `/api/*  ${API}/:splat  200`,
      '/media/*  https://x/room-photos/:splat  200',
      '/*  /index.html  200',
    ]);
  });

  it('omits the media rule when the storage origin is unset or empty', () => {
    const without = buildRedirects(API);
    expect(lines(without)).toHaveLength(2);
    expect(without).not.toContain('/media/');
    expect(buildRedirects(API, undefined)).toBe(without);
    expect(buildRedirects(API, '')).toBe(without);
  });

  it('strips trailing slashes from the storage origin', () => {
    const rule = '/media/*  https://x/room-photos/:splat  200';
    expect(lines(buildRedirects(API, 'https://x/'))[1]).toBe(rule);
    expect(lines(buildRedirects(API, 'https://x//'))[1]).toBe(rule);
  });

  it('rejects a storage origin that is not https', () => {
    expect(() => buildRedirects(API, 'http://x')).toThrow(STORAGE_MESSAGE);
    expect(() => buildRedirects(API, 'x.example')).toThrow(STORAGE_MESSAGE);
    expect(() => buildRedirects(API, 'https://')).toThrow(STORAGE_MESSAGE);
  });

  it('still rejects a bad API origin first, with its own message', () => {
    expect(() => buildRedirects('http://x', 'https://y')).toThrow(MESSAGE);
  });

  it('CLI exits non-zero with the storage message when STORAGE_PUBLIC_ORIGIN is not https', () => {
    const env = { ...process.env, API_PROXY_ORIGIN: API, STORAGE_PUBLIC_ORIGIN: 'http://x' };
    const result = spawnSync(process.execPath, [scriptPath], { env, encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(STORAGE_MESSAGE);
  });
});
