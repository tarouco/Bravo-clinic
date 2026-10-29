Bravô Clinic is a building of smart rooms ("salas inteligentes") for health, beauty and wellness professionals. Its interfaces feel like a calm, bright studio: a soft gray ground, pearl-white cards floating in layers, emerald for action, gold for highlights and Marrom Luxo for words. Everything should read premium, light and effortless, with few words and a lot of air.

## Content fundamentals

- Write in Brazilian Portuguese. Short, warm, declarative lines; no exclamation marks, no emoji.
- Speak to the professional as "você". Lead with the benefit to their practice, then the detail.
- Less text: one title and one sentence per card; buttons are one word when possible ("Reservar", "Começar", "Detalhes"). Let photos and icons carry the rest.
- The three pillars come in this order: **Saúde · Beleza · Bem-estar**. Reference line: "Saúde, beleza e bem-estar em um só lugar."
- The name is always **Bravô** with the circumflex, and **Bravô Clinic** in full. The descriptor is **Salas Inteligentes**. Never "Bravo" without the accent.
- Uppercase only for the name in `display-xl` and for `eyebrow` labels; titles and buttons are sentence case.

## Color

- Five brand colors: **Cinza Névoa** `surface` #E7E6E3, **Branco Pérola** `surface-raised` #FBFAF8, **Verde Esmeralda** `emerald` #0F6B52 (gradient to `emerald-deep` #0A3B2C), **Ouro** `gold` #FFEB97 (gradient to `gold-deep`) and **Marrom Luxo** #583714, which is the text color `ink`.
- Roles: `emerald` is the primary action and the active or selected state; `gold` is the highlight (one special card, price tags, the secondary pill); `ink` is every word on light surfaces; `brown` is the tertiary pill.
- Text pairs: `ink` on `surface` 8.5:1 and on `surface-raised` 10:1; `on-emerald` on emerald 6.2:1 (gold titles 5.4:1); `on-gold` on gold 8.9:1. `ink-muted` for captions holds 5.2:1 on every surface. `neon` and `gold` are never text on light surfaces.
- One colored card per screen or viewport (emerald or gold); everything else is pearl on névoa.
- Gradients come only from these colors: emerald (`#127A5E → emerald → emerald-deep`), gold (`#FFF6CF → gold → gold-deep`), pearl and Ouro → Marrom. `components/bundle.css` exposes them as `--grad-emerald`, `--grad-gold`, `--grad-pearl`, `--grad-brown` and `--grad-luxe`.
- Two themes: **Day** (névoa, default) and **Night** (deep brown ground, gold text, from the earlier brown-and-gold study). Every text pair above holds 4.5:1 in both.

## Layers and relief

- Three layers, always: `surface` (névoa) at the back, `surface-panel` or a translucent `glass` panel in the middle, `surface-raised` (pearl) cards on top. Each layer up adds one shadow level: `lift-1` small items, `lift-2` cards, `lift-3` panels, bars and anything that overlaps another layer. Every raised surface also carries `rim`, a thin light top edge.
- Overlap is a signature: the nav bar sits over the panel's top edge, a card may hang past the panel by up to `space-12`, the price tag floats over the room photo, the FAB rises out of the tab bar. At most one overlapping element per area.
- Controls are high-relief pills: `relief-emerald`, `relief-gold`, `relief-pearl`, `relief-brown`. Pressed states and the active nav item sink into low relief with `deboss`.
- Corners: `radius-pill` for every button, chip, toggle, bar and nav item; `radius-lg` (28px) for cards; `radius-xl` (34px) for panels and sheets; `radius-md` (24px) for app tiles and list rows; `radius-sm` (16px) for icon tiles and thumbnails.
- Decorative stone orbs, a gold sun glow and a white pedestal may sit on the névoa stage of web heroes, behind the panel, never on text.

## Neon interaction

Every button-like control (**Button**, **IconButton**, **Chip**, **Toggle**, the **Slider** knob, tabs, the FAB and day pills) shares one behavior:

- **Hover or keyboard focus:** a neon stroke runs around the border (one lap every 1.5 s), drawn in `neon` with a `neon-hot` head and a soft blurred glow. Brown buttons run a `gold-deep` neon.
- **Click:** the whole border lights up in `neon` and stays lit for 1.6 s; the button sinks into `deboss` while pressed.
- **Selected or on** (chosen chip, toggle on, chosen day, dragging slider knob): the neon stays fully lit for as long as the state lasts.
- Disabled controls get no neon and no relief (42% opacity).
- With reduced motion requested, the running stroke stops but stays visible on hover.
- Implementation: `components/bundle.css` draws the neon with a masked conic gradient on `::before`/`::after`; `components/bundle.js` (`BravoClinic.init()`) adds click-to-light, toggles, single-choice groups, slider dragging and nav states.

## Navigation

- **Website:** the **NavBar** pill floats over the top of the panel. Hovering a link shades its area with translucent `glass-hover` (`blur-hover`); the current link is weight 600 inside a debossed pill (`surface-deboss` + `deboss`). One emerald "Reservar" at the end.
- **App:** the glass **TabBar** floats 14px above the bottom edge: four icon tabs (current in `emerald`) and the emerald FAB for "nova reserva" in the middle.
- **Menus** are `glass` dropdowns with the same hover shading and debossed current row; **Modals** are pearl at the top layer over a blurred `scrim`.

## Translucency

- `glass` (with `blur-glass`) for panels and menus floating over photos or the stage; `glass-bar` for the tab bar. `ink` stays legible on both over any content.
- Never stack glass on glass; where `backdrop-filter` is missing or reduced transparency is requested, glass becomes solid `surface-panel` / `surface-raised` (handled in `bundle.css`).

## Type

- Display is **Josefin Sans** (300 for titles, 400 for card titles); text is **Jost**. Both load from Google Fonts. They are close matches chosen for the brand, not confirmed official fonts.
- `display-l` for screen and hero titles (sentence case); `heading` for card titles; `eyebrow` for wide-tracked labels in `emerald`; `lead` for the one hero sentence; `body` for card text; `label` for buttons; `caption` for metadata.

## Space

- App screens: `space-5` (20px) side margins, `space-4` between cards, `space-24` of bottom padding above the tab bar.
- Web: `space-6` between cards, `space-8` panel padding, `space-16` around the stage and between sections.
- Prefer more air over more content: if a screen feels full, remove words before shrinking spacing.

## Imagery

- Warm interior and facade photography: stone, marble, wood, orchids, soft light. Photos appear as full-bleed tops of room screens, tilted thumbnails on emerald cards and rounded thumbnails (`radius-sm`) in lists. Never cold clinical scenes, stock smiles or blue tints.
- The **Imagery** group holds placeholder renders until real photography exists.

## Logo

- The **Logos** group has only raster crops from the facade render, for drafts and presentations. Never redraw or recolor the mark; in interfaces, set the name in type ("BRAVÔ" in the display face, wide tracking), as the NavBar does.
- Lockup: BRAVÔ (the A as an open Λ, the Ô with its circumflex), CLINIC in wide spacing, then — SALAS INTELIGENTES — between two rules. The Ô alone is the monogram.

## Iconography

- No official icon set yet. Use outline icons with a 1.7px stroke and rounded caps, drawn in `currentColor`: `ink-muted` at rest, `emerald` when active, `on-emerald`/`on-gold` on colored fills. No filled icons (except a chosen favorite heart) and no emoji.
