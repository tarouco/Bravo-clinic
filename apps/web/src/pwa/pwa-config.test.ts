import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ManifestOptions } from 'vite-plugin-pwa';
import { describe, expect, it } from 'vitest';
import { pwaOptions } from '../../pwa.config';

// Vitest runs with the workspace (apps/web) as cwd.
const publicFile = (relative: string): Buffer =>
  readFileSync(resolve(process.cwd(), 'public', relative));

function manifestOf(): Partial<ManifestOptions> {
  const { manifest } = pwaOptions;
  if (!manifest) throw new Error('pwaOptions.manifest is missing');
  return manifest;
}

/** Width and height from the IHDR chunk of a PNG. */
function pngSize(file: Buffer): { width: number; height: number } {
  return { width: file.readUInt32BE(16), height: file.readUInt32BE(20) };
}

describe('web manifest (FND-119)', () => {
  it('declares the identity, display and color fields', () => {
    expect(manifestOf()).toMatchObject({
      name: 'Bravô Clinic – Salas Inteligentes',
      short_name: 'Bravô',
      lang: 'pt-BR',
      start_url: '/app',
      scope: '/',
      display: 'standalone',
      background_color: '#e7e6e3',
      theme_color: '#0f6b52',
    });
  });

  it('declares the 192, 512 and 512 maskable icons', () => {
    expect(manifestOf().icons).toEqual([
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      {
        src: '/icons/icon-512-maskable.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ]);
  });

  it('ships icon files whose pixel size matches the manifest entries', () => {
    expect(pngSize(publicFile('icons/icon-192.png'))).toEqual({ width: 192, height: 192 });
    expect(pngSize(publicFile('icons/icon-512.png'))).toEqual({ width: 512, height: 512 });
    expect(pngSize(publicFile('icons/icon-512-maskable.png'))).toEqual({
      width: 512,
      height: 512,
    });
  });
});

describe('service worker (FND-120)', () => {
  const workbox = pwaOptions.workbox;

  it('asks the user before activating a new version', () => {
    expect(pwaOptions.registerType).toBe('prompt');
  });

  it('precaches the built scripts, styles and html', () => {
    const patterns = (workbox?.globPatterns ?? []).join(' ');
    expect(patterns).toMatch(/js/);
    expect(patterns).toMatch(/css/);
    expect(patterns).toMatch(/html/);
  });

  it('serves every /api/ request NetworkOnly and nothing else', () => {
    const [route, ...others] = workbox?.runtimeCaching ?? [];
    expect(others).toEqual([]);
    expect(route?.handler).toBe('NetworkOnly');

    const matches = route?.urlPattern as (context: { url: URL; sameOrigin: boolean }) => boolean;
    const call = (href: string, sameOrigin = true) =>
      matches({ url: new URL(href, 'https://bravo-clinic.netlify.app'), sameOrigin });
    expect(call('/api/health')).toBe(true);
    expect(call('/api/app/me')).toBe(true);
    expect(call('/salas')).toBe(false);
    expect(call('/assets/index.js')).toBe(false);
    expect(call('https://other.example/api/health', false)).toBe(false);
  });

  it('never answers /api/ navigations with the SPA shell', () => {
    const [denied, ...others] = workbox?.navigateFallbackDenylist ?? [];
    expect(others).toEqual([]);
    expect(denied?.test('/api/x')).toBe(true);
    expect(denied?.test('/app')).toBe(false);
  });
});
