import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import resolveConfig from 'tailwindcss/resolveConfig';
import config from '../../tailwind.config';

// Minimal reader for the YAML front matter of docs/design/DESIGN.md: a two-level map
// (`section:` -> `key: scalar` or `key:` -> `prop: scalar`). No YAML dependency on purpose.
type Scalar = string;
type Section = Record<string, Scalar | Record<string, Scalar>>;

function parseDesignFrontMatter(source: string): Record<string, Section> {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  expect(lines[0]).toBe('---');
  const end = lines.indexOf('---', 1);
  expect(end).toBeGreaterThan(1);

  const unquote = (value: string): string => value.trim().replace(/^'(.*)'$/, '$1');
  const result: Record<string, Section> = {};
  let section: Section | undefined;
  let group: Record<string, Scalar> | undefined;

  for (const line of lines.slice(1, end)) {
    if (line.trim() === '') continue;
    const indent = line.length - line.trimStart().length;
    const separator = line.indexOf(':');
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1);

    if (indent === 0) {
      if (value.trim() === '') {
        section = {};
        result[key] = section;
      } else {
        section = undefined;
      }
      group = undefined;
    } else if (indent === 2 && section) {
      if (value.trim() === '') {
        group = {};
        section[key] = group;
      } else {
        section[key] = unquote(value);
        group = undefined;
      }
    } else if (indent === 4 && group) {
      group[key] = unquote(value);
    }
  }
  return result;
}

// Vitest runs with the workspace (apps/web) as cwd.
const designMd = readFileSync(resolve(process.cwd(), '../../docs/design/DESIGN.md'), 'utf8');
const design = parseDesignFrontMatter(designMd);
const extend = config.theme.extend;

describe('tailwind.config.ts design tokens', () => {
  it('maps every DESIGN.md color key to rgb(var(--c-<key>) / <alpha-value>)', () => {
    const colorKeys = Object.keys(design['colors'] ?? {});
    expect(colorKeys).toEqual(expect.arrayContaining(['surface', 'bronze', 'bronze-night']));
    const colors: Record<string, string> = extend.colors;
    for (const key of colorKeys) {
      expect(colors[key], `color ${key}`).toBe(`rgb(var(--c-${key}) / <alpha-value>)`);
    }
  });

  it('maps every typography token to [size, { lineHeight, letterSpacing, fontWeight }]', () => {
    const tokens = Object.entries(design['typography'] ?? {});
    expect(tokens.map(([name]) => name)).toEqual([
      'display-xl',
      'display-xl-mobile',
      'display-l',
      'display-l-mobile',
      'heading',
      'heading-mobile',
      'eyebrow',
      'lead',
      'body',
      'small',
      'caption',
    ]);
    const fontSize: Record<string, unknown> = extend.fontSize;
    for (const [name, spec] of tokens) {
      const t = spec as Record<string, string>;
      expect(fontSize[name], `fontSize ${name}`).toEqual([
        t['fontSize'],
        {
          lineHeight: t['lineHeight'],
          letterSpacing: t['letterSpacing'],
          fontWeight: t['fontWeight'],
        },
      ]);
    }
    expect(fontSize['display-xl']).toEqual([
      '64px',
      { lineHeight: '68px', letterSpacing: '0.12em', fontWeight: '300' },
    ]);
    expect(fontSize['caption']).toEqual([
      '12px',
      { lineHeight: '18px', letterSpacing: '0.04em', fontWeight: '500' },
    ]);
  });

  it('uses Josefin Sans for display, heading and eyebrow and Jost for the rest', () => {
    const fontFamily: Record<string, string[]> = extend.fontFamily;
    for (const name of [
      'display-xl',
      'display-xl-mobile',
      'display-l',
      'display-l-mobile',
      'heading',
      'heading-mobile',
      'eyebrow',
    ]) {
      expect(fontFamily[name], name).toEqual(['Josefin Sans', 'sans-serif']);
    }
    for (const name of ['lead', 'body', 'small', 'caption']) {
      expect(fontFamily[name], name).toEqual(['Jost', 'sans-serif']);
    }
    expect(fontFamily['display']).toEqual(['Josefin Sans', 'sans-serif']);
    expect(fontFamily['sans']).toEqual(['Jost', 'sans-serif']);
    for (const [name, spec] of Object.entries(design['typography'] ?? {})) {
      const family = (spec as Record<string, string>)['fontFamily'];
      expect(fontFamily[name]?.[0], `DESIGN.md family of ${name}`).toBe(family);
    }
  });

  it('copies the reference radius scale and adds the semantic aliases', () => {
    const radius: Record<string, string> = extend.borderRadius;
    expect(radius['DEFAULT']).toBe('.125rem');
    expect(radius['lg']).toBe('.25rem');
    expect(radius['xl']).toBe('.5rem');
    expect(radius['full']).toBe('.75rem');
    expect(radius['control']).toBe('2px');
    expect(radius['card']).toBe('8px');
    expect(radius['feature']).toBe('20px');
    expect(radius['pill']).toBe('9999px');
  });

  it('maps the DESIGN.md spacing tokens and keeps the Tailwind default scale', () => {
    const spacing: Record<string, string> = extend.spacing;
    for (const [name, value] of Object.entries(design['spacing'] ?? {})) {
      expect(spacing[name], `spacing ${name}`).toBe(value);
    }
    expect(spacing['space-hero']).toBe('6rem');

    const resolved = resolveConfig(config);
    expect(resolved.theme.spacing['4']).toBe('1rem');
    expect(resolved.theme.spacing['space-md']).toBe('1rem');
    expect(resolved.theme.borderRadius['2xl']).toBe('1rem');
    expect(resolved.theme.borderRadius['md']).toBe('0.375rem');
    expect(resolved.theme.borderRadius['DEFAULT']).toBe('.125rem');
  });

  it('exposes the glow and raised shadows through CSS variables', () => {
    expect(extend.boxShadow['glow']).toBe('var(--shadow-glow)');
    expect(extend.boxShadow['raised']).toBe('var(--shadow-raised)');
    expect(resolveConfig(config).theme.boxShadow['md']).toEqual(expect.any(String));
  });

  it('switches dark mode on data-theme="night" and scans index.html and src', () => {
    expect(config.darkMode).toEqual(['selector', '[data-theme="night"]']);
    expect(config.content).toEqual(['./index.html', './src/**/*.{ts,tsx}']);
  });
});
