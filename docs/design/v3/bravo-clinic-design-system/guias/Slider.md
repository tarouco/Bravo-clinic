# Slider

A draggable range control: a sunken track, an emerald fill and a pearl relief knob whose neon runs on hover and lights while dragging.

**Markup the consumer provides:** `div.bv-slider` with `role="slider"`, `tabindex="0"`, `aria-label`, `aria-valuemin="0"`, `aria-valuemax="100"`, `aria-valuenow` (start value) and two children: `span.bv-slider-fill` and `span.bv-slider-knob`. Optional `data-bv-output="<id>"` names an element that shows the value as a percentage. `BravoClinic.init()` adds pointer dragging, click-to-jump and arrow/Home/End keys, and fires a bubbling `bv:change` event with `detail.value` (0–100). Map 0–100 to your own unit.

- Default width 230px; set `width` on the element to change it.
- Always show the current value next to the slider.
