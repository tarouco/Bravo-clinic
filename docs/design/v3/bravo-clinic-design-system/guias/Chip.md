# Chip

A pearl pill for one choice in a set (time slots, filters); the selected chip turns emerald with its neon fully lit, and the others show the running neon on hover.

**Markup the consumer provides:** a container `.bv-chips` with `data-bv-group`, and inside it `button.bv-chip` elements with `aria-pressed="true"` on the selected one and `"false"` on the rest. `BravoClinic.init()` makes clicks select one chip per group.

- Three to five chips per row; labels are short ("11h", "Estética").
- Exactly one selected in a single-choice group; for multi-select, manage `aria-pressed` yourself.
