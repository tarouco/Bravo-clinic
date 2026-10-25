/** Joins the truthy class names. */
export const cx = (...parts: (string | false | null | undefined)[]): string =>
  parts.filter(Boolean).join(' ');

/** 2px bronze ring with a 2px offset, shown on keyboard focus only (DESIGN.md: keyboard focus). */
export const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bronze focus-visible:ring-offset-2 focus-visible:ring-offset-surface';
