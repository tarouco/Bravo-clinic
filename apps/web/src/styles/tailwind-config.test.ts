import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import resolveConfig from 'tailwindcss/resolveConfig';
import config from '../../tailwind.config';

// Vitest runs with the workspace (apps/web) as cwd. The brand kit preset is the source (AD-038).
const preset = readFileSync(
  resolve(
    process.cwd(),
    '../../docs/design/v3/bravo-clinic-design-system/tokens/tailwind.preset.js',
  ),
  'utf8',
);
const presetColorSection = preset.slice(preset.indexOf('"colors"'), preset.indexOf('"spacing"'));
const presetColors = [...presetColorSection.matchAll(/"([a-z-]+)": "var\(--[a-z-]+\)"/g)].map(
  (m) => m[1] ?? '',
);
const extend = config.theme.extend;

describe('tailwind.config.ts design tokens', () => {
  it('maps every v3 preset color (except glass/scrim/focus) to rgb(var(--c-<key>) / <alpha-value>)', () => {
    const colors: Record<string, string> = extend.colors;
    const channelColors = presetColors.filter(
      (key) => !/^(glass|scrim|focus-ring)/.test(key) && !key.startsWith('grad-'),
    );
    expect(channelColors).toEqual(expect.arrayContaining(['surface', 'emerald', 'gold', 'ink']));
    for (const key of channelColors) {
      expect(colors[key], `color ${key}`).toBe(`rgb(var(--c-${key}) / <alpha-value>)`);
    }
    for (const key of ['accent', 'danger', 'bronze', 'champagne']) {
      expect(colors[key], `color ${key}`).toBe(`rgb(var(--c-${key}) / <alpha-value>)`);
    }
  });

  it('uses the v3 app sizes for the mobile, body, label and caption styles', () => {
    const fontSize: Record<string, unknown> = extend.fontSize;
    expect(fontSize['display-l-mobile']).toEqual([
      '30px',
      { lineHeight: '34px', letterSpacing: '0.02em', fontWeight: '300' },
    ]);
    expect(fontSize['heading-mobile']).toEqual([
      '19px',
      { lineHeight: '26px', letterSpacing: '0.04em', fontWeight: '400' },
    ]);
    expect(fontSize['eyebrow']).toEqual([
      '11px',
      { lineHeight: '16px', letterSpacing: '0.32em', fontWeight: '400' },
    ]);
    expect(fontSize['label']).toEqual([
      '14.5px',
      { lineHeight: '16px', letterSpacing: '0.04em', fontWeight: '500' },
    ]);
    expect(fontSize['caption']).toEqual([
      '12px',
      { lineHeight: '18px', letterSpacing: '0.02em', fontWeight: '400' },
    ]);
  });

  it('uses Josefin Sans for display, heading and eyebrow and Jost for the rest', () => {
    const fontFamily: Record<string, string[]> = extend.fontFamily;
    for (const name of [
      'display-xl',
      'display-l',
      'heading',
      'heading-mobile',
      'eyebrow',
      'display',
    ]) {
      expect(fontFamily[name]?.[0], name).toBe('Josefin Sans');
    }
    for (const name of ['lead', 'body', 'small', 'label', 'caption', 'sans']) {
      expect(fontFamily[name]?.[0], name).toBe('Jost');
    }
  });

  it('uses the v3 radius scale and maps the v2 aliases onto it', () => {
    const radius: Record<string, string> = extend.borderRadius;
    expect(radius).toMatchObject({
      sm: '16px',
      md: '24px',
      lg: '28px',
      xl: '34px',
      pill: '9999px',
    });
    expect(radius['full']).toBe('9999px');
    expect(radius['control']).toBe('9999px');
    expect(radius['card']).toBe('28px');
    expect(radius['feature']).toBe('34px');
  });

  it('keeps the semantic spacing names and the Tailwind default scale', () => {
    const spacing: Record<string, string> = extend.spacing;
    expect(spacing['space-md']).toBe('1rem');
    expect(spacing['space-hero']).toBe('6rem');
    expect(resolveConfig(config).theme.spacing['4']).toBe('1rem');
  });

  it('exposes lift, rim, relief, deboss and neon shadows through CSS variables', () => {
    const shadow: Record<string, string> = extend.boxShadow;
    for (const name of [
      'lift-1',
      'lift-2',
      'lift-3',
      'rim',
      'relief-emerald',
      'deboss',
      'neon-glow',
    ]) {
      expect(shadow[name], name).toBe(`var(--${name})`);
    }
    expect(shadow['card']).toBe('var(--lift-2), var(--rim)');
  });

  it('switches dark mode on data-theme="night" and scans index.html and src', () => {
    expect(config.darkMode).toEqual(['selector', '[data-theme="night"]']);
    expect(config.content).toEqual(['./index.html', './src/**/*.{ts,tsx}']);
  });
});
