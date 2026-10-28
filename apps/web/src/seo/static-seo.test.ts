import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_SITE_URL, resolveSiteUrl } from '../../site-url';

// Vitest runs with the workspace (apps/web) as cwd.
const readText = (relative: string): string =>
  readFileSync(resolve(process.cwd(), relative), 'utf8').replace(/\r\n/g, '\n');

const SITE_URL = 'https://bravo-clinic.netlify.app';
const OG_DESCRIPTION = 'Saúde · Beleza · Bem-estar em um só lugar';

const html = readText('index.html');
let doc: Document;

beforeAll(() => {
  doc = new DOMParser().parseFromString(html, 'text/html');
});

const meta = (selector: string): string | null =>
  doc.querySelector(`meta[${selector}]`)?.getAttribute('content') ?? null;

interface OpeningHours {
  dayOfWeek: string[];
  opens: string;
  closes: string;
}

interface LocalBusiness {
  '@type': string;
  name: string;
  url: string;
  address: Record<string, string>;
  openingHoursSpecification: OpeningHours[];
}

describe('index.html head', () => {
  it('is pt-BR with a title and a meta description', () => {
    expect(doc.documentElement.getAttribute('lang')).toBe('pt-BR');
    expect(doc.title.length).toBeGreaterThan(0);
    expect(meta('name="description"')?.length ?? 0).toBeGreaterThan(0);
  });

  it('declares the Open Graph tags with an absolute 1200x630 image', () => {
    expect(meta('property="og:type"')).toBe('website');
    expect(meta('property="og:title"')?.length ?? 0).toBeGreaterThan(0);
    expect(meta('property="og:description"')).toBe(OG_DESCRIPTION);
    expect(meta('property="og:locale"')).toBe('pt_BR');
    expect(meta('property="og:image"')).toBe('%VITE_SITE_URL%/og-image.jpg');

    // The JPEG's start-of-frame segment holds height then width.
    const jpeg = readFileSync(resolve(process.cwd(), 'public/og-image.jpg'));
    const sof = jpeg.findIndex(
      (byte, i) => byte === 0xff && [0xc0, 0xc2].includes(jpeg[i + 1] ?? 0),
    );
    expect(sof).toBeGreaterThan(-1);
    expect({ width: jpeg.readUInt16BE(sof + 7), height: jpeg.readUInt16BE(sof + 5) }).toEqual({
      width: 1200,
      height: 630,
    });
  });

  it('carries exactly one LocalBusiness JSON-LD block with address and opening hours', () => {
    const blocks = doc.querySelectorAll('script[type="application/ld+json"]');
    expect(blocks).toHaveLength(1);

    const data = JSON.parse(blocks[0]?.textContent ?? '') as LocalBusiness;
    expect(data['@type']).toBe('LocalBusiness');
    expect(data.name).toBe('Bravô Clinic – Salas Inteligentes');
    expect(data.url).toBe('%VITE_SITE_URL%');
    expect(data.address).toMatchObject({
      streetAddress: 'Praia Brava',
      addressLocality: 'Itajaí',
      addressRegion: 'SC',
      addressCountry: 'BR',
    });
    expect(data.openingHoursSpecification).toHaveLength(2);
    expect(data.openingHoursSpecification).toMatchObject([
      {
        dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
        opens: '07:00',
        closes: '23:59',
      },
      { dayOfWeek: ['Saturday', 'Sunday'], opens: '09:00', closes: '23:59' },
    ]);
  });

  it('loads Josefin Sans and Jost from Google Fonts with display=swap, and nothing else', () => {
    const stylesheets = [...doc.querySelectorAll('link[rel="stylesheet"]')].map(
      (link) => link.getAttribute('href') ?? '',
    );
    const fonts = stylesheets.find((href) => href.startsWith('https://fonts.googleapis.com/'));
    expect(fonts).toContain('Josefin+Sans');
    expect(fonts).toContain('Jost');
    expect(fonts).toContain('display=swap');

    expect(html).not.toContain('cdn.tailwindcss.com');
    expect(html).not.toContain('Material+Symbols');
  });
});

describe('inline scripts and the CSP (GES-143)', () => {
  it('lists the sha256 of every inline script of index.html in the netlify.toml script-src', () => {
    const csp = /Content-Security-Policy = "([^"]*)"/.exec(readText('../../netlify.toml'))?.[1];
    const scriptSrc = /script-src([^;]*)/.exec(csp ?? '')?.[1] ?? '';
    const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1] ?? '');

    expect(inline).toHaveLength(2);
    for (const body of inline) {
      const hash = createHash('sha256').update(body).digest('base64');
      expect(scriptSrc).toContain(`'sha256-${hash}'`);
    }
  });
});

describe('site url substitution (FND-122)', () => {
  it('defaults to the production site when VITE_SITE_URL is not set or empty', () => {
    expect(DEFAULT_SITE_URL).toBe(SITE_URL);
    expect(resolveSiteUrl(undefined)).toBe(SITE_URL);
    expect(resolveSiteUrl('')).toBe(SITE_URL);
  });

  it('keeps a configured URL, without its trailing slash', () => {
    expect(resolveSiteUrl('https://bravo.example.com/')).toBe('https://bravo.example.com');
    expect(resolveSiteUrl('https://example.invalid')).toBe('https://example.invalid');
  });
});

describe('robots.txt and sitemap.xml (FND-124)', () => {
  it('disallows /app and /admin for every crawler', () => {
    const lines = readText('public/robots.txt').split('\n');
    expect(lines).toContain('User-agent: *');
    expect(lines).toContain('Disallow: /app');
    expect(lines).toContain('Disallow: /admin');
  });

  it('lists the eight public routes with the site URL', () => {
    const urls = [...readText('public/sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map(
      (match) => match[1],
    );
    expect(urls).toEqual(
      [
        '/',
        '/salas',
        '/precos',
        '/servicos-extras',
        '/politicas',
        '/contato',
        '/termos',
        '/privacidade',
      ].map((path) => `${SITE_URL}${path}`),
    );
  });
});
