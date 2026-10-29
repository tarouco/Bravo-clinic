import type { Config } from 'tailwindcss';

// Design System v3 tokens (AD-038), mapped in docs/design/v3-mapa-de-tokens.md.
// Colors resolve to CSS variables (RGB channels) defined in src/styles/tokens.css, so Day/Night
// switching and alpha utilities (bg-surface/90) both work.

/** v3 color roles plus the derived status tokens (AD-042). */
const v3ColorKeys = [
  'surface',
  'surface-panel',
  'surface-raised',
  'surface-deboss',
  'ink',
  'ink-muted',
  'border',
  'hairline',
  'emerald',
  'emerald-deep',
  'on-emerald',
  'gold',
  'gold-deep',
  'gold-soft',
  'on-gold',
  'brown',
  'on-brown',
  'neon',
  'neon-hot',
  'accent',
  'accent-deep',
  'on-accent',
  'danger',
  'danger-soft',
  'on-danger',
] as const;

const colors = Object.fromEntries(
  v3ColorKeys.map((key) => [key, `rgb(var(--c-${key}) / <alpha-value>)`]),
) as Record<(typeof v3ColorKeys)[number], string>;

const display = ['Josefin Sans', 'Futura', 'Century Gothic', 'system-ui', 'sans-serif'];
const reading = ['Jost', 'Futura', 'system-ui', 'sans-serif'];

export default {
  darkMode: ['selector', '[data-theme="night"]'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors,
      fontFamily: {
        'display-xl': display,
        'display-xl-mobile': display,
        'display-l': display,
        'display-l-mobile': display,
        heading: display,
        'heading-mobile': display,
        eyebrow: display,
        lead: reading,
        body: reading,
        small: reading,
        label: reading,
        caption: reading,
        display,
        sans: reading,
      },
      // v3 scale is drawn for 390px app screens (the "-mobile" sizes and body/label/caption);
      // the unsuffixed display/heading/lead sizes are the web variants (~1.3–1.4×), DESIGN-v3.md §Type.
      fontSize: {
        'display-xl': ['58px', { lineHeight: '64px', letterSpacing: '0.1em', fontWeight: '300' }],
        'display-xl-mobile': [
          '38px',
          { lineHeight: '44px', letterSpacing: '0.1em', fontWeight: '300' },
        ],
        'display-l': ['42px', { lineHeight: '48px', letterSpacing: '0.02em', fontWeight: '300' }],
        'display-l-mobile': [
          '30px',
          { lineHeight: '34px', letterSpacing: '0.02em', fontWeight: '300' },
        ],
        heading: ['24px', { lineHeight: '32px', letterSpacing: '0.04em', fontWeight: '400' }],
        'heading-mobile': [
          '19px',
          { lineHeight: '26px', letterSpacing: '0.04em', fontWeight: '400' },
        ],
        eyebrow: ['11px', { lineHeight: '16px', letterSpacing: '0.32em', fontWeight: '400' }],
        lead: ['17px', { lineHeight: '27px', letterSpacing: '0em', fontWeight: '400' }],
        body: ['15px', { lineHeight: '24px', letterSpacing: '0em', fontWeight: '400' }],
        small: ['14px', { lineHeight: '22px', letterSpacing: '0em', fontWeight: '400' }],
        label: ['14.5px', { lineHeight: '16px', letterSpacing: '0.04em', fontWeight: '500' }],
        caption: ['12px', { lineHeight: '18px', letterSpacing: '0.02em', fontWeight: '400' }],
      },
      spacing: {
        gutter: '1.5rem',
        margin: '1.5rem',
        'space-xs': '0.25rem',
        'space-sm': '0.5rem',
        'space-md': '1rem',
        'space-lg': '1.5rem',
        'space-xl': '2rem',
        'space-2xl': '3rem',
        'space-3xl': '4rem',
        'space-hero': '6rem',
      },
      borderRadius: {
        DEFAULT: '16px',
        sm: '16px',
        md: '24px',
        lg: '28px',
        xl: '34px',
        full: '9999px',
        pill: '9999px',
      },
      boxShadow: {
        'lift-1': 'var(--lift-1)',
        'lift-2': 'var(--lift-2)',
        'lift-3': 'var(--lift-3)',
        rim: 'var(--rim)',
        card: 'var(--lift-2), var(--rim)',
        panel: 'var(--lift-3), var(--rim)',
        'relief-pearl': 'var(--relief-pearl)',
        'relief-emerald': 'var(--relief-emerald)',
        'relief-gold': 'var(--relief-gold)',
        'relief-brown': 'var(--relief-brown)',
        deboss: 'var(--deboss)',
        'neon-glow': 'var(--neon-glow)',
      },
      backgroundImage: {
        'grad-emerald': 'var(--grad-emerald)',
        'grad-gold': 'var(--grad-gold)',
        'grad-pearl': 'var(--grad-pearl)',
        'grad-brown': 'var(--grad-brown)',
        'grad-luxe': 'var(--grad-luxe)',
      },
      backdropBlur: {
        glass: '20px',
        hover: '8px',
        scrim: '6px',
      },
      backgroundColor: {
        glass: 'var(--glass)',
        'glass-bar': 'var(--glass-bar)',
        'glass-hover': 'var(--glass-hover)',
        scrim: 'var(--scrim)',
      },
    },
  },
} satisfies Config;
