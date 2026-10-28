import { useSyncExternalStore } from 'react';

// Prerendered pages (GES-143) hydrate markup rendered at build time, without a window and on
// another day. Parts that depend on the screen or the date render their server form until
// hydration ends; a plain client render (no prerendered markup, tests) is hydrated at once.

const subscribeNever = () => () => undefined;

/** False on the server and while React hydrates prerendered markup, true afterwards. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
}

/** `query` on the client (read once, like a one-time `matchMedia` check); false on the server. */
export function useMediaQueryOnce(query: string): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => typeof window.matchMedia === 'function' && window.matchMedia(query).matches,
    () => false,
  );
}
