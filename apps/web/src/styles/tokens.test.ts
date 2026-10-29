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

/** Extracts `--name: value;` declarations of the first rule whose selector starts with `selector`. */
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
const dayBlock = declarations(css, ':root,');
const nightBlock = declarations(css, '\n[data-theme="night"] {');
const sharedBlock = declarations(css, ':root {');

// The brand kit (docs/design/v3) is the source of truth (AD-038).
const kit = read('../../docs/design/v3/bravo-clinic-design-system/tokens/tokens.css');
const kitDay = declarations(kit, ':root, [data-theme="light"]');
const kitNight = declarations(kit, '[data-theme="dark"]');

const flat = (value: string | undefined) => value?.replace(/\s+/g, ' ');

/** v3 colors given as #hex in the kit (hairline is rgba and is stored flattened). */
const hexColors = (block: Map<string, string>) =>
  [...block].filter(([name, value]) => /^#[0-9a-f]{6}$/i.test(value) && name !== '--focus-ring');

describe('tokens.css', () => {
  it('holds every v3 Dia color of the brand kit as RGB channels', () => {
    const colors = hexColors(kitDay);
    expect(colors.length).toBeGreaterThanOrEqual(15);
    for (const [name, hex] of colors) {
      expect(dayBlock.get(`--c-${name.slice(2)}`), `day ${name}`).toBe(toChannels(hex));
    }
  });

  it('holds every v3 Noite color of the brand kit, inheriting the ones Noite keeps', () => {
    for (const [name, hex] of hexColors(kitNight)) {
      const channel = `--c-${name.slice(2)}`;
      expect(nightBlock.get(channel) ?? dayBlock.get(channel), `night ${name}`).toBe(
        toChannels(hex),
      );
    }
  });

  it('copies the kit shadows, relief, glass and scrim per theme', () => {
    for (const name of ['--lift-1', '--lift-2', '--lift-3', '--rim', '--deboss', '--neon-glow']) {
      expect(flat(dayBlock.get(name)), `day ${name}`).toBe(flat(kitDay.get(name)));
      expect(flat(nightBlock.get(name)), `night ${name}`).toBe(flat(kitNight.get(name)));
    }
    for (const name of ['--glass', '--glass-bar', '--glass-hover', '--scrim']) {
      expect(dayBlock.get(name), `day ${name}`).toBe(kitDay.get(name));
      expect(nightBlock.get(name), `night ${name}`).toBe(kitNight.get(name));
    }
  });

  it('makes accent emerald by day and gold by night', () => {
    expect(dayBlock.get('--c-accent')).toBe(toChannels('#0f6b52'));
    expect(nightBlock.get('--c-accent')).toBe(toChannels('#ffeb97'));
  });

  it('applies the Day block to :root and to data-theme="day"', () => {
    expect(css).toMatch(/:root,\s*\[data-theme="day"\]\s*\{/);
  });

  it('defines every color referenced by tailwind.config.ts', () => {
    const colors = Object.values(config.theme.extend.colors);
    expect(colors.length).toBeGreaterThanOrEqual(25);
    for (const value of colors) {
      const variable = /var\((--c-[a-z0-9-]+)\)/.exec(value)?.[1] ?? '';
      expect(dayBlock.has(variable) || sharedBlock.has(variable), variable).toBe(true);
    }
  });

  it('no longer defines the v2 names (AD-039 step 2)', () => {
    for (const name of [
      '--c-bronze',
      '--c-champagne',
      '--c-walnut',
      '--c-on-surface',
      '--c-error',
    ]) {
      expect(css.includes(`${name}:`), name).toBe(false);
    }
  });

  it('sets color-scheme per theme', () => {
    expect(css).toMatch(/color-scheme:\s*light;/);
    expect(css).toMatch(/color-scheme:\s*dark;/);
  });

  it('styles body with bg-surface, text-ink and font-body', () => {
    expect(css).toMatch(/body\s*\{[^}]*@apply[^;]*bg-surface[^;]*;/);
    expect(css).toMatch(/body\s*\{[^}]*@apply[^;]*text-ink[^;]*;/);
    expect(css).toMatch(/body\s*\{[^}]*@apply[^;]*font-body[^;]*;/);
  });

  it('is imported by index.css with bv.css, both before the Tailwind layers', () => {
    const index = read('src/styles/index.css');
    expect(index.indexOf("@import './tokens.css'")).toBeGreaterThan(-1);
    expect(index.indexOf("@import './tokens.css'")).toBeLessThan(
      index.indexOf("@import './bv.css'"),
    );
    expect(index.indexOf("@import './bv.css'")).toBeLessThan(index.indexOf('@tailwind base'));
  });
});
