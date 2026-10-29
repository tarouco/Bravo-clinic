/** Joins the truthy class names. */
export const cx = (...parts: (string | false | null | undefined)[]): string =>
  parts.filter(Boolean).join(' ');

/** 2px accent ring (emerald by day, gold by night) with a 2px offset, keyboard focus only (DESIGN-v3.md). */
export const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface';
