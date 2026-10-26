import { vi } from 'vitest';
import { resetAnalytics } from '../lib/analytics';

// Test helpers for the funnel analytics (GES-133..GES-136): a GA4 provider whose commands land
// in `window.dataLayer`, where the tests read them back.

/** Selects the GA4 provider for the test and starts from an empty data layer. */
export function enableGa4(id = 'G-TEST123'): void {
  vi.stubEnv('VITE_ANALYTICS_PROVIDER', 'ga4');
  vi.stubEnv('VITE_GA4_ID', id);
  resetAnalytics();
  delete window.dataLayer;
}

/** Puts everything `enableGa4` changed back; call it from `afterEach`. */
export function disableAnalytics(): void {
  vi.unstubAllEnvs();
  resetAnalytics();
  delete window.dataLayer;
  document.querySelectorAll('script[data-analytics]').forEach((node) => {
    node.remove();
  });
}

export interface GtagEvent {
  name: string;
  params: Record<string, unknown>;
}

/** The `gtag('event', name, params)` commands in the data layer, in order. */
export function gtagEvents(): GtagEvent[] {
  return (window.dataLayer ?? [])
    .map((entry) => Array.from(entry as ArrayLike<unknown>))
    .filter((command) => command[0] === 'event')
    .map((command) => ({
      name: String(command[1]),
      params: (command[2] ?? {}) as Record<string, unknown>,
    }));
}

/** The commands of one kind (`js`, `config`, `event`) in the data layer. */
export function gtagCommands(kind: string): unknown[][] {
  return (window.dataLayer ?? [])
    .map((entry) => Array.from(entry as ArrayLike<unknown>))
    .filter((command) => command[0] === kind);
}
