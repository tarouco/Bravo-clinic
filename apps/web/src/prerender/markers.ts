// Markers that tie a prerendered page (GES-143) to the path it was rendered for.

/** `<script type="application/json">` holding the dehydrated TanStack Query state. */
export const PRERENDER_STATE_ID = 'bravo-prerender-state';

/** "/salas/" -> "/salas"; "/" stays "/". */
export function normalizePath(path: string): string {
  const trimmed = path.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

/** True when #root holds markup prerendered for `pathname`. */
export function isPrerenderedFor(root: HTMLElement, pathname: string): boolean {
  const rendered = root.dataset['prerendered'];
  return rendered !== undefined && normalizePath(rendered) === normalizePath(pathname);
}
