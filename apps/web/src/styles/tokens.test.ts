import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import config from '../../tailwind.config';

// Vitest runs with the workspace (apps/web) as cwd.
const read = (relative: string): string =>
  readFileSync(resolve(process.cwd(), relative), 'utf8').replace(/\r\n/g, '\n');

const toChannels = (hex: string): string => {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(' ');
};

/** Reads the Day/Night table of docs/architecture.md section 9.3 (the spec for FND-82). */
function parseThemeTable(): { day: Map<string, string>; night: Map<string, string> } {
  const architecture = read('../../docs/architecture.md');
  const start = architecture.indexOf('### 9.3');
  const end = architecture.indexOf('Other tokens:', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);

  const day = new Map<string, string>();
  const night = new Map<string, string>();
  for (const line of architecture.slice(start, end).split('\n')) {
    if (!line.startsWith('| `')) continue;
    const [tokenCell = '', dayCell = '', nightCell = ''] = line
      .trim()
      .slice(1, -1)
      .split('|')
      .map((cell) => cell.trim());
    const tokens = [...tokenCell.matchAll(/`([a-z0-9-]+)`/g)].map((m) => m[1] ?? '');
    // A row may list several tokens that share one value (`on-background` / `on-surface`).
    const spread = (hex: string[]): string[] =>
      hex.length === 1 ? tokens.map(() => hex[0] ?? '') : hex;
    const dayHex = spread(dayCell.match(/#[0-9a-fA-F]{6}/g) ?? []);
    const nightHex = nightCell.startsWith('same')
      ? dayHex
      : spread(nightCell.match(/#[0-9a-fA-F]{6}/g) ?? []);
    expect(dayHex.length, tokenCell).toBe(tokens.length);
    expect(nightHex.length, tokenCell).toBe(tokens.length);
    tokens.forEach((token, i) => {
      day.set(token, toChannels(dayHex[i] ?? ''));
      night.set(token, toChannels(nightHex[i] ?? ''));
    });
  }
  return { day, night };
}

/** Extracts `--name: value;` declarations of the rule whose selector starts with `selector`. */
function declarations(css: string, selector: string): Map<string, string> {
  const open = css.indexOf(selector);
  expect(open, `selector ${selector}`).toBeGreaterThan(-1);
  const body = css.slice(css.indexOf('{', open) + 1, css.indexOf('}', open));
  const result = new Map<string, string>();
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    result.set(m[1] ?? '', (m[2] ?? '').trim());
  }
  return result;
}

// Prettier rewrites attribute selector quotes to single quotes; compare quote-agnostically.
const css = read('src/styles/tokens.css').replace(/'/g, '"');
const dayBlock = declarations(css, ':root');
const nightBlock = declarations(css, '[data-theme="night"]');
const table = parseThemeTable();

describe('tokens.css', () => {
  it('holds the Day and Night value of every architecture 9.3 token as RGB channels', () => {
    expect(table.day.size).toBeGreaterThanOrEqual(70);
    for (const [token, value] of table.day) {
      expect(dayBlock.get(`--c-${token}`), `day --c-${token}`).toBe(value);
    }
    for (const [token, value] of table.night) {
      expect(nightBlock.get(`--c-${token}`), `night --c-${token}`).toBe(value);
    }
  });

  it('resolves the documented sample tokens to the documented channels', () => {
    expect(dayBlock.get('--c-surface')).toBe('245 238 230');
    expect(nightBlock.get('--c-surface')).toBe('29 20 14');
    expect(dayBlock.get('--c-bronze')).toBe('122 70 29');
    expect(nightBlock.get('--c-bronze')).toBe('220 170 130');
    expect(dayBlock.get('--c-champagne-soft')).toBe('239 220 205');
    expect(nightBlock.get('--c-champagne-soft')).toBe('74 53 38');
  });

  it('applies the Day block to :root and to data-theme="day"', () => {
    expect(css).toMatch(/:root,\s*\[data-theme="day"\]\s*\{/);
  });

  it('defines every color referenced by tailwind.config.ts in both blocks', () => {
    const colors = Object.values(config.theme.extend.colors);
    expect(colors.length).toBeGreaterThanOrEqual(70);
    for (const value of colors) {
      const variable = /var\((--c-[a-z0-9-]+)\)/.exec(value)?.[1] ?? '';
      expect(dayBlock.has(variable), `day ${variable}`).toBe(true);
      expect(nightBlock.has(variable), `night ${variable}`).toBe(true);
    }
  });

  it('defines the glow and raised shadows and color-scheme per theme', () => {
    expect(dayBlock.get('--shadow-glow')).toBe('0 0 24px rgba(218, 175, 147, 0.45)');
    expect(nightBlock.get('--shadow-glow')).toBe('0 0 28px rgba(229, 188, 161, 0.35)');
    expect(dayBlock.get('--shadow-raised')).toBe(
      '0 1px 2px rgba(46, 26, 12, 0.06), 0 8px 24px rgba(46, 26, 12, 0.08)',
    );
    expect(nightBlock.get('--shadow-raised')).toBe(
      '0 1px 2px rgba(0, 0, 0, 0.4), 0 8px 24px rgba(0, 0, 0, 0.35)',
    );
    expect(css).toMatch(/color-scheme:\s*light;/);
    expect(css).toMatch(/color-scheme:\s*dark;/);
  });

  it('styles body with bg-surface, text-on-surface and font-body', () => {
    expect(css).toMatch(/body\s*\{[^}]*@apply[^;]*bg-surface[^;]*;/);
    expect(css).toMatch(/body\s*\{[^}]*@apply[^;]*text-on-surface[^;]*;/);
    expect(css).toMatch(/body\s*\{[^}]*@apply[^;]*font-body[^;]*;/);
  });

  it('is imported by index.css before the Tailwind layers', () => {
    const index = read('src/styles/index.css');
    expect(index.indexOf("@import './tokens.css'")).toBeGreaterThan(-1);
    expect(index.indexOf("@import './tokens.css'")).toBeLessThan(index.indexOf('@tailwind base'));
  });
});
