import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { deferEntry, ENTRY_LOADER, injectPrerender, outputFile } from './prerender.mjs';

const TEMPLATE = '<html><head></head><body><div id="root"></div><script></script></body></html>';

describe('injectPrerender (GES-143)', () => {
  it('puts the markup in #root, marks the path and adds the query state as JSON', () => {
    const page = injectPrerender(TEMPLATE, '/salas', '<main>Salas</main>', { queries: [] });

    expect(page).toContain(
      '<div id="root" data-prerendered="/salas"><main>Salas</main></div>' +
        '<script type="application/json" id="bravo-prerender-state">{"queries":[]}</script>',
    );
  });

  it('escapes "<" in the state so the JSON never closes its script element', () => {
    const page = injectPrerender(TEMPLATE, '/', '', { name: '</script><b>' });

    expect(page).toContain('{"name":"\\u003c/script>\\u003cb>"}');
    expect(page.match(/<\/script>/g)).toHaveLength(2);
  });

  it('fails when the template has no empty #root', () => {
    expect(() => injectPrerender('<div id="app"></div>', '/', '', {})).toThrow('#root');
  });
});

describe('deferEntry (GES-143)', () => {
  const FONTS = 'https://fonts.googleapis.com/css2?family=Jost&display=swap';
  const FONT_LINKS =
    `<link\n  rel="preload"\n  as="style"\n  href="${FONTS}"\n/>\n` +
    `<link\n  rel="stylesheet"\n  media="print"\n  data-brand-fonts\n  href="${FONTS}"\n/>\n`;
  const PAGE =
    `<head>${FONT_LINKS}<script type="module" crossorigin src="/assets/index-abc.js"></script>\n` +
    '<link rel="stylesheet" href="/assets/index.css"></head><body><div id="root"></div></body>';

  it('replaces the entry script and the font links with the loader at the end of the body', () => {
    const page = deferEntry(PAGE);

    expect(page).not.toContain('type="module"');
    expect(page).not.toContain('fonts.googleapis.com/css2?family=Jost&display');
    expect(page).toContain('<link rel="stylesheet" href="/assets/index.css">');
    expect(page).toContain(
      `<script data-entry="/assets/index-abc.js" ` +
        `data-fonts="https://fonts.googleapis.com/css2?family=Jost&amp;display=swap">` +
        `${ENTRY_LOADER}</script></body>`,
    );
  });

  it('fails when the page has no module entry or no font links', () => {
    expect(() => deferEntry(`<head>${FONT_LINKS}</head><body></body>`)).toThrow('entry script');
    expect(() =>
      deferEntry('<script type="module" crossorigin src="/a.js"></script><body></body>'),
    ).toThrow('Google Fonts');
  });

  it('has its sha256 in the netlify.toml script-src', () => {
    const toml = readFileSync(resolve(process.cwd(), '../../netlify.toml'), 'utf8');
    const csp = /Content-Security-Policy = "([^"]*)"/.exec(toml)?.[1] ?? '';
    const hash = createHash('sha256').update(ENTRY_LOADER).digest('base64');

    expect(/script-src([^;]*)/.exec(csp)?.[1]).toContain(`'sha256-${hash}'`);
  });
});

describe('outputFile', () => {
  it('maps a page to the file Netlify serves it from', () => {
    expect(outputFile('/')).toBe('home.html');
    expect(outputFile('/salas')).toBe('salas.html');
    expect(outputFile('/salas/principal')).toBe('salas/principal.html');
  });
});
