// Bravô Clinic — preset Tailwind (v3). Carregue tokens/tokens.css e components/bundle.css antes.
// tailwind.config.js: module.exports = { presets: [require('./tailwind.preset.js')], darkMode: ['selector', '[data-theme="dark"]'] }
module.exports = {
  "theme": {
    "extend": {
      "colors": {
        "surface": "var(--surface)",
        "surface-panel": "var(--surface-panel)",
        "surface-raised": "var(--surface-raised)",
        "surface-deboss": "var(--surface-deboss)",
        "ink": "var(--ink)",
        "ink-muted": "var(--ink-muted)",
        "border": "var(--border)",
        "hairline": "var(--hairline)",
        "emerald": "var(--emerald)",
        "emerald-deep": "var(--emerald-deep)",
        "on-emerald": "var(--on-emerald)",
        "gold": "var(--gold)",
        "gold-deep": "var(--gold-deep)",
        "on-gold": "var(--on-gold)",
        "brown": "var(--brown)",
        "on-brown": "var(--on-brown)",
        "neon": "var(--neon)",
        "neon-hot": "var(--neon-hot)",
        "glass": "var(--glass)",
        "glass-bar": "var(--glass-bar)",
        "glass-hover": "var(--glass-hover)",
        "scrim": "var(--scrim)",
        "focus-ring": "var(--focus-ring)"
      },
      "spacing": {
        "1": "4px",
        "2": "8px",
        "3": "12px",
        "4": "16px",
        "5": "20px",
        "6": "24px",
        "8": "32px",
        "12": "48px",
        "16": "64px"
      },
      "borderRadius": {
        "sm": "16px",
        "md": "24px",
        "lg": "28px",
        "xl": "34px",
        "pill": "9999px"
      },
      "boxShadow": {
        "lift-1": "var(--lift-1)",
        "lift-2": "var(--lift-2)",
        "lift-3": "var(--lift-3)",
        "rim": "var(--rim)",
        "relief-pearl": "var(--relief-pearl)",
        "relief-emerald": "var(--relief-emerald)",
        "relief-gold": "var(--relief-gold)",
        "relief-brown": "var(--relief-brown)",
        "deboss": "var(--deboss)",
        "neon-glow": "var(--neon-glow)"
      },
      "backgroundImage": {
        "grad-emerald": "var(--grad-emerald)",
        "grad-gold": "var(--grad-gold)",
        "grad-pearl": "var(--grad-pearl)",
        "grad-brown": "var(--grad-brown)",
        "grad-luxe": "var(--grad-luxe)"
      },
      "fontFamily": {
        "display": [
          "Josefin Sans",
          "Futura",
          "Century Gothic",
          "system-ui",
          "sans-serif"
        ],
        "sans": [
          "Jost",
          "Futura",
          "system-ui",
          "sans-serif"
        ]
      }
    }
  }
};
