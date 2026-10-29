# Button

A high-relief pill button: on hover a neon stroke runs around its border, on click the neon lights fully for 1.6 s, and pressing sinks it into low relief.

**Markup the consumer provides:** `button.bv-btn` plus one variant: `bv-btn--emerald` (the primary action), `bv-btn--gold` (secondary highlight), `bv-btn--pearl` (neutral) or `bv-btn--brown` (tertiary, gold neon). Optional sizes `bv-btn--sm` (40px) and `bv-btn--block` (full width, 54px). An optional leading 1.7px outline SVG icon. Load `components/bundle.js` and call `BravoClinic.init()` once so the click-to-light behavior works; hover neon and pressed relief are pure CSS.

- One emerald button per view; it is the action the screen exists for (Reservar, Confirmar).
- Labels are one word whenever possible, in `label` style; never all caps.
- Disabled uses the `disabled` attribute: 42% opacity, no relief, no neon.
- The neon is light, not decoration: it only appears on hover, focus, click and selected states.
- Don't put two gold buttons side by side; pair gold with emerald or pearl.
