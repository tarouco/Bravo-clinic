# Modal

A pearl dialog at the top layer (`lift-3`, `radius-xl`) over a dimmed, blurred `scrim`, for confirmations and short booking steps; on phones it becomes a bottom sheet.

**Markup the consumer provides:** a full-area `.bv-scrim` and inside it `div.bv-modal` with `role="dialog"`, `aria-modal="true"` and `aria-labelledby`; content: optional `.bv-card-eyebrow`, `h3.bv-modal-title`, `p.bv-modal-body` and `.bv-modal-actions` (pearl secondary first, emerald primary last). Add `.bv-sheet` for the bottom-sheet variant. The consumer handles open/close, focus trap and focus return.

- One primary action, one sentence of body text.
- Max width 440px; longer flows become a page.
- Esc and a tap on the scrim close it unless typed data would be lost.
