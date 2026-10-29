# IconButton

A round high-relief button for a single icon (add, favorite, search, notifications), with the same running-neon hover and click-to-light behavior as **Button**.

**Markup the consumer provides:** `button.bv-icon-btn` with a color variant class (`bv-btn--emerald`, `bv-btn--gold`, `bv-btn--pearl`, `bv-btn--brown`), an inline 1.7px outline SVG and an `aria-label` in Portuguese. `bv-icon-btn--sm` gives 42px; default is 54px.

- Use pearl for utilities (search, back, favorite), emerald only for the main add action.
- Always an `aria-label`; never an icon without a name.
- Icons are outline, rounded caps, `currentColor`; no filled icons except a chosen favorite heart.
