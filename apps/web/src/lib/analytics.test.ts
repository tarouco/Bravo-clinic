import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { track } from './analytics';

function reset(): void {
  document.head.querySelectorAll('script[data-ga4]').forEach((node) => {
    node.remove();
  });
  delete window.dataLayer;
}

beforeEach(reset);

afterEach(() => {
  vi.unstubAllEnvs();
  reset();
});

describe('track (NUC-206)', () => {
  it('does nothing without VITE_GA4_ID: no dataLayer, no script', () => {
    vi.stubEnv('VITE_GA4_ID', '');

    track('view_room', { slug: 'principal' });

    expect(window.dataLayer).toBeUndefined();
    expect(document.querySelectorAll('script[data-ga4]')).toHaveLength(0);
  });

  it('pushes the event with its props to window.dataLayer when VITE_GA4_ID is set', () => {
    vi.stubEnv('VITE_GA4_ID', 'G-TEST123');

    track('purchase', { code: 'BRV-7K2Q9X', value: 219 });

    expect(window.dataLayer).toContainEqual({
      event: 'purchase',
      code: 'BRV-7K2Q9X',
      value: 219,
    });
  });

  it('injects the gtag script once, for the configured id, across several events', () => {
    vi.stubEnv('VITE_GA4_ID', 'G-TEST123');

    track('view_room');
    track('select_slot');
    track('begin_checkout');

    const scripts = document.querySelectorAll<HTMLScriptElement>('script[data-ga4]');
    expect(scripts).toHaveLength(1);
    expect(scripts[0]?.src).toBe('https://www.googletagmanager.com/gtag/js?id=G-TEST123');
    expect(window.dataLayer?.filter((entry) => (entry as { event?: string }).event)).toHaveLength(
      3,
    );
  });
});
