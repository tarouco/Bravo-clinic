import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

// Production-like static server for Lighthouse CI (GES-143). `vite preview` sends every file
// uncompressed, so the simulated slow 4G of the mobile preset downloads ~3x the bytes Netlify
// serves. This server compresses text files with brotli or gzip per Accept-Encoding, sends the
// netlify.toml cache headers, falls back to index.html for SPA routes and proxies `/api/*` to the
// local API with the prefix stripped (AD-015), like the Vite proxy.

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

const COMPRESSIBLE = new Set([
  '.html',
  '.js',
  '.mjs',
  '.css',
  '.json',
  '.webmanifest',
  '.svg',
  '.txt',
  '.xml',
]);

/** `br` when the client accepts it, else `gzip`, else null (identity). */
export function pickEncoding(acceptEncoding) {
  const accepted = String(acceptEncoding ?? '')
    .split(',')
    .map((part) => part.trim().split(';')[0].trim().toLowerCase());
  if (accepted.includes('br')) return 'br';
  if (accepted.includes('gzip')) return 'gzip';
  return null;
}

/**
 * The file under `root` that serves `urlPath`, like Netlify: the file itself, else `<path>.html`
 * (prerendered pages, GES-143), with `/` rewritten to `home.html` when it exists; else
 * `index.html` for SPA routes. Paths that would leave `root` also get the shell.
 */
export function resolveFile(root, urlPath) {
  const path = decodeURIComponent(urlPath.split('?')[0]);
  const candidates = path === '/' ? ['/home.html'] : [path, `${path.replace(/\/+$/, '')}.html`];
  for (const name of candidates) {
    const candidate = normalize(join(root, name));
    const inside = candidate.startsWith(root.endsWith(sep) ? root : root + sep);
    if (inside && existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return join(root, 'index.html');
}

/** Cache-Control of netlify.toml: fingerprinted assets are immutable, the shell revalidates. */
export function cacheControl(urlPath) {
  if (urlPath.startsWith('/assets/')) return 'public, max-age=31536000, immutable';
  return 'no-cache';
}

const cache = new Map();

function body(file, encoding) {
  const key = `${encoding ?? 'identity'}:${file}`;
  let data = cache.get(key);
  if (data === undefined) {
    const raw = readFileSync(file);
    if (encoding === 'br') {
      data = brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } });
    } else if (encoding === 'gzip') {
      data = gzipSync(raw, { level: 9 });
    } else {
      data = raw;
    }
    cache.set(key, data);
  }
  return data;
}

function proxy(req, res, apiOrigin) {
  const target = new URL(req.url.replace(/^\/api/, '') || '/', apiOrigin);
  const upstream = request(
    target,
    { method: req.method, headers: { ...req.headers, host: target.host } },
    (answer) => {
      res.writeHead(answer.statusCode ?? 502, answer.headers);
      answer.pipe(res);
    },
  );
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
    res.end('API unavailable');
  });
  req.pipe(upstream);
}

export function startServer({ root, port, apiOrigin }) {
  const server = createServer((req, res) => {
    const url = req.url ?? '/';
    if (url === '/api' || url.startsWith('/api/')) {
      proxy(req, res, apiOrigin);
      return;
    }
    const file = resolveFile(root, url);
    const ext = extname(file);
    const encoding = COMPRESSIBLE.has(ext) ? pickEncoding(req.headers['accept-encoding']) : null;
    const data = body(file, encoding);
    const headers = {
      'content-type': TYPES[ext] ?? 'application/octet-stream',
      'content-length': data.length,
      'cache-control': file.endsWith(`${sep}index.html`) ? 'no-cache' : cacheControl(url),
      vary: 'Accept-Encoding',
    };
    if (encoding) headers['content-encoding'] = encoding;
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : data);
  });
  server.listen(port, () => {
    process.stdout.write(`  Local: http://localhost:${String(port)}/\n`);
  });
  return server;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const root = fileURLToPath(new URL('../dist', import.meta.url));
  startServer({
    root: root.replace(/[\\/]+$/, ''),
    port: Number(process.env.PORT ?? '5175'),
    apiOrigin: process.env.DEV_API_ORIGIN ?? 'http://localhost:8787',
  });
}
