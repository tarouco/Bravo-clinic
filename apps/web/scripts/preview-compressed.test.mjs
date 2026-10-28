import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliDecompressSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cacheControl, pickEncoding, resolveFile, startServer } from './preview-compressed.mjs';

describe('pickEncoding (GES-143)', () => {
  it('prefers brotli, then gzip, else identity', () => {
    expect(pickEncoding('gzip, deflate, br')).toBe('br');
    expect(pickEncoding('gzip;q=1.0, deflate')).toBe('gzip');
    expect(pickEncoding('identity')).toBeNull();
    expect(pickEncoding(undefined)).toBeNull();
  });
});

describe('cacheControl', () => {
  it('matches netlify.toml: immutable assets, revalidated shell', () => {
    expect(cacheControl('/assets/index-abc.js')).toBe('public, max-age=31536000, immutable');
    expect(cacheControl('/salas')).toBe('no-cache');
  });
});

describe('preview server', () => {
  let root;
  let server;
  let origin;

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'bravo-preview-'));
    mkdirSync(join(root, 'assets'));
    writeFileSync(join(root, 'index.html'), '<!doctype html><div id="root"></div>');
    writeFileSync(join(root, 'assets', 'app.js'), 'console.log("x");'.repeat(200));
    server = startServer({ root, port: 0, apiOrigin: 'http://127.0.0.1:9' });
    await new Promise((resolve) => server.once('listening', resolve));
    origin = `http://127.0.0.1:${String(server.address().port)}`;
  });

  afterAll(() => {
    server.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('falls back to index.html for SPA routes and never leaves the root', () => {
    expect(resolveFile(root, '/salas/principal')).toBe(join(root, 'index.html'));
    expect(resolveFile(root, '/../../etc/passwd')).toBe(join(root, 'index.html'));
    expect(resolveFile(root, '/assets/app.js')).toBe(join(root, 'assets', 'app.js'));
  });

  it('serves a fingerprinted script brotli-compressed with the immutable cache header', async () => {
    const response = await fetch(`${origin}/assets/app.js`, {
      headers: { 'accept-encoding': 'br' },
    });
    expect(response.headers.get('content-encoding')).toBe('br');
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(response.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
  });

  it('answers an SPA route with the shell, revalidated', async () => {
    const response = await fetch(`${origin}/salas`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('<div id="root">');
    expect(response.headers.get('cache-control')).toBe('no-cache');
  });

  it('reports 502 when the API behind /api is down', async () => {
    const response = await fetch(`${origin}/api/health`);
    expect(response.status).toBe(502);
  });

  it('decompresses to the original bytes', async () => {
    const { request } = await import('node:http');
    const raw = await new Promise((resolve, reject) => {
      request(`${origin}/assets/app.js`, { headers: { 'accept-encoding': 'br' } }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      })
        .on('error', reject)
        .end();
    });
    expect(brotliDecompressSync(raw).toString()).toBe('console.log("x");'.repeat(200));
  });
});
