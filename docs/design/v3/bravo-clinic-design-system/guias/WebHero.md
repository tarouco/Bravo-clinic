# WebHero

The website's opening composition and the reference for how layers stack: `surface` stage, a translucent `bv-panel`, pearl and colored cards on top, with the nav bar and two cards overlapping the panel's edges.

**What the consumer provides:** a stage on `surface`; inside it a `.bv-panel` whose first child is the **NavBar** pulled up over the panel's top edge (negative top margin of about 52px); then a 3-column grid of **Card**s: a tall pearl hero card (eyebrow, `display-l` title, one `lead` sentence, gold + emerald buttons), a gold card, a pearl card hanging past the right edge (`bv-overhang-end`), an emerald silk card and a small pearl card.

- Decorative stone orbs, a gold sun glow and a pedestal may sit on the stage behind the panel; never on top of text.
- One emerald card and one gold card per view.
- Under 900px, stack the grid in one column and remove overhangs.
