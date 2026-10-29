# Menu

A translucent dropdown (account, context, overflow) on `glass` with a blurred backdrop; rows shade on hover like the nav links, and the current row is bold in a debossed pill.

**Markup the consumer provides:** `div.bv-menu` with `role="menu"`; children `button.bv-menu-item` (`role="menuitem"`, `aria-selected="true"` on the current row), optional `.bv-menu-label` titles, `hr.bv-menu-sep` dividers and a trailing `.bv-meta`. Icons are 1.7px outline SVGs. Position it yourself, anchored to its trigger.

- Up to 7 items; exit actions last, after a separator.
- Never inside a modal or over another glass layer.
- Keyboard: arrow keys move focus, Esc closes.
