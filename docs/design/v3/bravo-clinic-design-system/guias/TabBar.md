# TabBar

The app's bottom navigation: a translucent pill (`glass-bar`, `blur-glass`) floating 14px above the screen edge, four tabs and an emerald FAB that rises out of the bar.

**Markup the consumer provides:** `div.bv-tabbar` (positioned absolute inside the screen; add `data-bv-group`) with four `button.bv-tab` icon buttons (each with `aria-label`, the current one `aria-current="page"`) and one `button.bv-fab` in the middle for the main create action. `BravoClinic.init()` moves the current tab on click in prototypes.

- The current tab is `emerald` (Night: `gold`); others `ink-muted`.
- The FAB is the only emerald element in the bar and always means "nova reserva".
- Leave `space-24` of bottom padding in scrolling content so nothing hides behind the bar.
