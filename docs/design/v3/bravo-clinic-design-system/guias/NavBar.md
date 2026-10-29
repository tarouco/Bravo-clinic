# NavBar

The floating top bar of the website: a pearl pill with the name in type, section links and one emerald action; hovering a link shades its area translucently, and the active link is bold inside a debossed (low-relief) pill.

**Markup the consumer provides:** `nav.bv-navbar` (add `data-bv-nav` to let `BravoClinic.init()` move the active state on click in prototypes) with `span.bv-navbar-brand` (the name in type), `a.bv-navbar-link` items with `aria-current="page"` on the current one, an optional `span.bv-navbar-spacer` and one `.bv-btn--emerald.bv-btn--sm`. In a real site, set `aria-current` from the route instead of `data-bv-nav`.

- Three to five links; the brand is never a cropped logo image.
- The bar overlaps the top edge of the panel below it (see the WebHero pattern).
- The active state is always the debossed pill plus weight 600, never an underline or color change alone.
