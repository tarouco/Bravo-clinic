# Card

The floating surface of every screen: a pearl card (`bv-card`) with soft wide shadow and a lit top edge, plus two accent variants, gold (`bv-card--gold`) and emerald with a silk wave (`bv-card--emerald`).

**Markup the consumer provides:** `div.bv-card` (optionally `--gold` or `--emerald`) containing any of `.bv-card-eyebrow`, `h3.bv-card-title`, `p.bv-card-text` and buttons. For the emerald silk, add the `svg.bv-silk` wave shown in the preview as the last child. Cards sit on a `bv-panel` or straight on `surface`.

- One sentence per card; let photos, icons and the button carry the rest.
- One colored card (gold or emerald) per screen or viewport; the rest are pearl.
- Cards may hang past the edge of their panel by up to `space-12` (`bv-overhang-end` / `bv-overhang-start`) to create overlapping layers; at most one overhang per area.
- Text on emerald is `on-emerald` with `gold` titles; text on gold is `on-gold`.
