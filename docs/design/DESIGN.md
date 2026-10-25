---
name: Bravô Serene Architecture
colors:
  surface: '#f5eee6'
  surface-dim: '#e0d9d1'
  surface-bright: '#fff8f1'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#faf2ea'
  surface-container: '#f4ede5'
  surface-container-high: '#eee7df'
  surface-container-highest: '#e8e1da'
  on-surface: '#1e1b17'
  on-surface-variant: '#52443b'
  inverse-surface: '#33302b'
  inverse-on-surface: '#f7f0e8'
  outline: '#84746a'
  outline-variant: '#d7c3b7'
  surface-tint: '#885127'
  primary: '#5e3007'
  on-primary: '#ffffff'
  primary-container: '#7a461d'
  on-primary-container: '#ffb785'
  inverse-primary: '#ffb784'
  secondary: '#795740'
  on-secondary: '#ffffff'
  secondary-container: '#ffd1b3'
  on-secondary-container: '#7a5840'
  tertiary: '#5a3215'
  on-tertiary: '#ffffff'
  tertiary-container: '#75482a'
  on-tertiary-container: '#f8b993'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#ffdcc6'
  primary-fixed-dim: '#ffb784'
  on-primary-fixed: '#301400'
  on-primary-fixed-variant: '#6b3a12'
  secondary-fixed: '#ffdcc6'
  secondary-fixed-dim: '#eabea1'
  on-secondary-fixed: '#2d1604'
  on-secondary-fixed-variant: '#5f402a'
  tertiary-fixed: '#ffdbc7'
  tertiary-fixed-dim: '#f7b993'
  on-tertiary-fixed: '#311300'
  on-tertiary-fixed-variant: '#673c1f'
  background: '#fff8f1'
  on-background: '#1e1b17'
  surface-variant: '#e8e1da'
  surface-raised: '#fbf7f2'
  surface-stone: '#e7dace'
  hairline: '#cdb8a5'
  border: '#8f6f58'
  ink: '#2e1a0c'
  ink-muted: '#6b5445'
  champagne: '#daaf93'
  champagne-soft: '#efdccd'
  bronze: '#7a461d'
  on-bronze: '#fbf7f2'
  on-champagne: '#2e1a0c'
  walnut: '#63391c'
  surface-night: '#1d140e'
  surface-raised-night: '#281c14'
  surface-stone-night: '#34261c'
  hairline-night: '#4d3a2c'
  border-night: '#8a6e5a'
  ink-night: '#f3e8dc'
  ink-muted-night: '#c2ad9b'
  champagne-night: '#e5bca1'
  champagne-soft-night: '#4a3526'
  bronze-night: '#dcaa82'
  on-bronze-night: '#1d140e'
  walnut-night: '#8a5530'
typography:
  display-xl:
    fontFamily: Josefin Sans
    fontSize: 64px
    fontWeight: '300'
    lineHeight: 68px
    letterSpacing: 0.12em
  display-xl-mobile:
    fontFamily: Josefin Sans
    fontSize: 36px
    fontWeight: '300'
    lineHeight: 42px
    letterSpacing: 0.1em
  display-l:
    fontFamily: Josefin Sans
    fontSize: 44px
    fontWeight: '300'
    lineHeight: 52px
    letterSpacing: 0.08em
  display-l-mobile:
    fontFamily: Josefin Sans
    fontSize: 28px
    fontWeight: '300'
    lineHeight: 34px
    letterSpacing: 0.06em
  heading:
    fontFamily: Josefin Sans
    fontSize: 28px
    fontWeight: '400'
    lineHeight: 36px
    letterSpacing: 0.04em
  heading-mobile:
    fontFamily: Josefin Sans
    fontSize: 22px
    fontWeight: '400'
    lineHeight: 28px
    letterSpacing: 0.03em
  eyebrow:
    fontFamily: Josefin Sans
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
    letterSpacing: 0.32em
  lead:
    fontFamily: Jost
    fontSize: 19px
    fontWeight: '300'
    lineHeight: 30px
    letterSpacing: 0em
  body:
    fontFamily: Jost
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 26px
    letterSpacing: 0em
  small:
    fontFamily: Jost
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 22px
    letterSpacing: 0em
  caption:
    fontFamily: Jost
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 18px
    letterSpacing: 0.04em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 1.5rem
  margin: 1.5rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2rem
  space-2xl: 3rem
  space-3xl: 4rem
  space-hero: 6rem
---

## Brand & Style

This design system translates the physical luxury and architectural serenity of high-end wellness into digital space. Drawing directly from the boutique aesthetic of the physical environment—warm limestone facades, indirect amber lighting, dark bronze window profiles, fluted walnut paneling, and brushed champagne metallic letterforms—it eschews the cold, clinical whites and overly saturated blues typical of medical software.

The aesthetic fuses **Architectural Minimalism** with **Tactile Warmth**:
- **Tone & Personality**: Serene, refined, hospitable, and precise. The interface serves healthcare, aesthetics, and wellness practitioners with an unhurried, reassuring presence.
- **Visual Rhythm**: Defined by generous breathing space, disciplined structural alignment, and subtle surface layering rather than aggressive dropshadows.
- **Copy & Voice**: Direct, declarative Brazilian Portuguese written in sentence case (reserving all-caps exclusively for brand signatures and wide-tracked eyebrows). The tri-pillar ordering is maintained consistently: *Saúde · Beleza · Bem-estar*.

## Colors

The color palette operates across two deliberate atmospheric modes: **Day** (light, default) and **Night** (dark). Both modes reflect real-world material surfaces under varying light conditions:
- **Canvas Ground**: `surface` mimics honed limestone in daylight and facade masonry at dusk.
- **Layering & Structural Panels**: `surface-raised` elevates cards and interactive controls, while `surface-stone` establishes subtle, grounded resting bands. `walnut` anchors rich, dark accent areas like footers and feature frames.
- **Accents & CTAs**: `bronze` acts as the primary interactive driver for buttons and selected states. `champagne` embodies the warm backlit signature, utilized for badges, glows, and refined accents. `champagne` is never applied as running body text over light surfaces.
- **Contrast & Legibility**: `ink` provides high-contrast typography, while `ink-muted` handles secondary captions. Structural controls leverage `border` (ensuring WCAG ≥ 3:1 compliance), reserving `hairline` strictly for subtle, non-essential dividers.

## Typography

The type system balances architectural geometry with haute-couture editorial rhythm:
- **Display Stacks (`Josefin Sans`)**: Characterized by slim, light strokes and wide kerning. Used for headlines, page titles, and uppercase eyebrows. The signature lockup device `— SALAS INTELIGENTES —` utilizes `eyebrow` styling with its generous `0.32em` tracking, flanked by thin hairlines.
- **Reading Stacks (`Jost`)**: Delivers clean, geometric clarity for paragraphs, tables, booking cards, and data forms.
- **Casing Rules**: Uppercase transformation is strictly reserved for `display-xl`, `display-l`, and `eyebrow`. All other headings, body copy, and form labels must use natural sentence case.

## Layout & Spacing

Layouts follow a structured **4px / 8px progressive rhythm** designed to produce an open, unhurried spatial balance:
- **Grid Architecture**: Standard 12-column responsive fluid grid for desktop with 24px (`1.5rem`) gutters and section max-widths of 1280px (`max-w-7xl`). Tablets compress into an 8-column layout with 16px gutters; mobile devices reduce to a 4-column structure with 16px margins.
- **Section Rhythm**: Vertical separation between distinct content modules expands from 48px (`space-2xl`) on handheld viewports to 64px (`space-3xl`) on desktop. Hero zones deploy an expansive 96px (`space-hero`) padding to establish calm spatial authority.
- **Visual Ratio**: Target a balance of roughly 60% serene canvas (`surface`), 30% structured containers and dividers (`surface-raised`, `hairline`), and 10% purposeful focal points (`bronze`, `champagne`).

## Elevation & Depth

Visual hierarchy is primarily communicated through planar material juxtaposition and architectural lighting cues, rather than heavy, generic drop shadows:
- **Planar Tiers**: Depth is established by placing `surface-raised` atop `surface`, bordered with precise 1px `hairline` dividers.
- **Backlit Halo (`glow`)**: Mimicking the reverse-lit champagne signage of the physical clinic, key focal elements (such as the primary brand mark or a selected state) utilize a soft luminescence:
  - *Day*: `0 0 24px rgba(218, 175, 147, 0.45)`
  - *Night*: `0 0 28px rgba(229, 188, 161, 0.35)`
- **Floating Surfaces (`shadow-raised`)**: Dropdown overlays, popovers, and elevated modal panels receive a warm-tinted, diffused elevation:
  - *Day*: `0 1px 2px rgba(46, 26, 12, 0.06), 0 8px 24px rgba(46, 26, 12, 0.08)`
  - *Night*: `0 1px 2px rgba(0, 0, 0, 0.4), 0 8px 24px rgba(0, 0, 0, 0.35)`

## Shapes

The shape vocabulary reflects sharp metal hardware, stone slabs, and tailored furnishings:
- **Architectural Edges (`radius-none` / 0px)**: Applied to structural image frames, hero photography, color bands, and section dividers.
- **Refined Controls (`radius-sm` / 2px)**: Applied to interactive controls—buttons, inputs, status tags, and time-slot selectors—recalling clean-cut metallic signage plaques.
- **Content Cards (`radius-md` / 8px)**: Applied to modules, booking containers, and dialogue panels.
- **Curved Accents (`radius-lg` / 20px)**: Reserved exclusively for rare feature modules echoing curved boutique lounge seating.
- **Avatars & Toggles (`rounded-full` / 9999px)**: Applied strictly to user avatars and circular status icons.

## Components

### Buttons & Interactive Controls
- **Primary CTA**: Solid fill in `bronze` with `on-bronze` text, sharp `radius-sm` (2px) corners, and a default height of 48px. Padding is `space-md` (16px) vertical by `space-lg` (24px) horizontal.
- **Secondary**: `surface-raised` background with a crisp 1px border in `border`, styled with `ink` text.
- **Tertiary / Ghost**: Transparent with `bronze` or `ink` text, transitioning on hover with a subtle `hairline` bottom border.
- **Keyboard Focus**: A 2px gap matching the underlying `surface`, enclosed by a 2px solid ring in `bronze`.

### Form Fields & Inputs
- **Base Style**: `surface-raised` background with a 1px solid stroke in `border` (`#8f6f58` Day / `#8a6e5a` Night), sized with `radius-sm` (2px) corners.
- **Text & Placeholders**: Input values render in `ink`; placeholders utilize `ink-muted`.
- **Labels**: Rendered above the field in `Josefin Sans` 12px or `Jost` 14px with `space-sm` (8px) margin bottom. Never hide field labels.
- **Focus State**: The outer border transitions smoothly to `bronze` with the standard focus-ring outline.

### Cards & Smart Room Containers
- **Container Structure**: Bound by `surface-raised` with a perimeter 1px stroke in `hairline`. Card corners adopt `radius-md` (8px).
- **Photography Integration**: Room and amenity images bleed edge-to-edge across the top portion of the card with square top corners (`radius-none`), anchoring cleanly into the frame.
- **Status Badges**: Mini-chips set in `champagne-soft` with `on-champagne` text, styled in uppercase `caption` with `0.08em` tracking.

### Booking & Schedule Grids
- **Time Slot Selectors**: 40px height rectangular blocks (`radius-sm`). Available slots display in `surface-raised` with a `hairline` border. Active/selected slots fill completely with `bronze` and `on-bronze` typography.
- **Dividers & Rules**: Hairline rules in `hairline` (1px) used sparingly between list elements and module headers.