# Toggle

An on/off switch: a sunken track with a pearl knob; switched on, the track fills with emerald and the neon ring stays lit; on hover the neon stroke runs around it.

**Markup the consumer provides:** `button.bv-toggle` with `role="switch"`, `aria-checked="true|false"`, an `aria-label` and one empty `<i>` child (the knob). `BravoClinic.init()` flips `aria-checked` on click; listen for `click` to persist the value.

- Use for settings that take effect immediately (notificações, lembretes); use a Button for actions that need confirmation.
- Put the text label next to it, never inside the track.
