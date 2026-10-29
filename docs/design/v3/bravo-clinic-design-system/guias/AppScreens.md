# AppScreens

Reference screens for the mobile app (Início, Sala, Agenda): `surface` ground, floating pearl cards, one colored card per screen, a glass **TabBar** with the rising FAB, and elements that overlap layers (the price tag over the photo, the FAB over the bar).

**What the consumer provides:** screens built only from system parts: **Card**, **IconButton**, **Chip**, **Button** (`bv-btn--block` for the main action), the `bv-week` / `bv-day` strip for dates, and **TabBar**. Side margin `space-5` (20px), 14–16px between cards.

- Little text: a title, one caption per card, one-word buttons; icons and photos do the rest.
- Room screens open with a full-bleed photo and a sheet (`radius-xl`) rising over it.
- The selected chip and day stay lit (neon) and emerald; everything tappable shows the running neon on hover or focus.
