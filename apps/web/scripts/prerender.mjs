import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Build-time prerender of the public pages (GES-143). After `vite build`, this bundles
// src/prerender/render.tsx for Node, renders `/`, `/salas` and every `/salas/:slug` into copies
// of dist/index.html and writes them where Netlify serves them without a redirect: home.html
// (`/` is rewritten to it by write-redirects.mjs), salas.html and salas/<slug>.html.
// dist/index.html stays the empty SPA shell (FND-125). Room data comes from the API at
// API_PROXY_ORIGIN; when it cannot be reached the room pages are skipped and stay SPA-only.

const STATE_ID = 'bravo-prerender-state';
const ROOT = '<div id="root"></div>';

/** The template with `html` inside #root, marked for `path`, and the query state beside it. */
export function injectPrerender(template, path, html, state) {
  if (!template.includes(ROOT)) throw new Error('prerender: #root not found in index.html');
  // `<` is escaped so the JSON can never close its script element.
  const json = JSON.stringify(state).replace(/</g, '\\u003c');
  const attr = path.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return template.replace(
    ROOT,
    `<div id="root" data-prerendered="${attr}">${html}</div>` +
      `<script type="application/json" id="${STATE_ID}">${json}</script>`,
  );
}

/**
 * Inline loader of prerendered pages. The markup is complete, so the bundle (which only hydrates
 * it) and the Google Fonts stylesheet are requested once the hero image or video has painted
 * (the largest-contentful-paint entry of an IMG or VIDEO): on slow phones neither competes with,
 * or runs before, the paint of the largest content, which uses the fallback font (`display=swap`
 * then swaps it in). On `/` the video poster paints a few frames after the first paint, so
 * waiting for the first paint alone is not enough. Without such an entry they load 1.5 s after
 * the first paint, and without paint timing (or in a tab that opens hidden) 3 s after `load`.
 * Links work before hydration (they are plain anchors); buttons wait for it. Its sha256 is in
 * the netlify.toml CSP.
 */
export const ENTRY_LOADER =
  '(function(){var me=document.currentScript,done=false;' +
  'function start(){if(done)return;done=true;' +
  "var href=me.getAttribute('data-fonts');if(href){var l=document.createElement('link');" +
  "l.rel='stylesheet';l.href=href;l.setAttribute('data-brand-fonts','');" +
  'document.head.appendChild(l);}' +
  "var s=document.createElement('script');s.type='module';" +
  "s.src=me.getAttribute('data-entry');document.head.appendChild(s);}" +
  "function media(e){var t=e.element&&e.element.tagName;return t==='IMG'||t==='VIDEO';}" +
  'try{var o=new PerformanceObserver(function(list){list.getEntries().forEach(function(e){' +
  "if(e.name==='first-contentful-paint')setTimeout(start,1500);" +
  "else if(e.entryType==='largest-contentful-paint'&&media(e)){o.disconnect();setTimeout(start,0);}" +
  "});});o.observe({type:'paint',buffered:true});" +
  "o.observe({type:'largest-contentful-paint',buffered:true});}catch(e){}" +
  "window.addEventListener('load',function(){setTimeout(start,3000);},{once:true});})();";

const FONT_LINKS =
  /<link\s+rel="preload"\s+as="style"\s+href="([^"]+)"\s*\/?>\s*<link\s+rel="stylesheet"\s+media="print"\s+data-brand-fonts\s+href="\1"\s*\/?>\s*/;

/**
 * The page with its module entry script and its two Google Fonts links (the preload and the
 * `print` stylesheet of index.html) replaced by the after-first-paint loader.
 */
export function deferEntry(page) {
  const tag = /<script type="module" crossorigin src="([^"]+)"><\/script>\s*/.exec(page);
  if (!tag) throw new Error('prerender: entry script not found in index.html');
  const fonts = FONT_LINKS.exec(page);
  if (!fonts) throw new Error('prerender: Google Fonts links not found in index.html');
  const loader = `<script data-entry="${tag[1]}" data-fonts="${fonts[1].replace(/&/g, '&amp;')}">`;
  return page
    .replace(tag[0], '')
    .replace(fonts[0], '')
    .replace('</body>', `${loader}${ENTRY_LOADER}</script></body>`);
}

/** The dist file Netlify serves `path` from: "/" -> home.html, "/salas/x" -> salas/x.html. */
export function outputFile(path) {
  return path === '/' ? 'home.html' : `${path.replace(/^\/+/, '')}.html`;
}

async function getJson(origin, path) {
  try {
    const response = await fetch(`${origin}${path}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

async function main() {
  const web = fileURLToPath(new URL('..', import.meta.url));
  const dist = `${web}dist`;
  const out = `${web}dist-prerender`;
  const { build } = await import('vite');
  await build({
    root: web,
    logLevel: 'warn',
    build: { ssr: 'src/prerender/render.tsx', outDir: out, emptyOutDir: true },
  });
  const { render } = await import(pathToFileURL(`${out}/render.js`).href);
  const template = readFileSync(`${dist}/index.html`, 'utf8');

  const pages = [{ path: '/', data: {} }];
  const origin = (process.env.API_PROXY_ORIGIN ?? '').replace(/\/+$/, '');
  const rooms = origin.startsWith('https://') ? await getJson(origin, '/public/rooms') : null;
  if (rooms && Array.isArray(rooms.items)) {
    pages.push({ path: '/salas', data: { rooms } });
    for (const item of rooms.items) {
      const room = await getJson(origin, `/public/rooms/${encodeURIComponent(item.slug)}`);
      if (room) pages.push({ path: `/salas/${item.slug}`, data: { room } });
    }
  } else {
    console.warn('prerender: room data unavailable, /salas pages stay SPA-only');
  }

  for (const { path, data } of pages) {
    const { html, state } = await render(path, data);
    const file = `${dist}/${outputFile(path)}`;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, deferEntry(injectPrerender(template, path, html, state)));
  }
  rmSync(out, { recursive: true, force: true });
  console.log(`prerender: ${pages.map((p) => p.path).join(', ')}`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  main().catch((error) => {
    console.error(`prerender: ${error instanceof Error ? error.stack : String(error)}`);
    process.exitCode = 1;
  });
}
