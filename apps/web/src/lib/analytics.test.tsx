import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { disableAnalytics, enableGa4, gtagCommands, gtagEvents } from '../test/analytics';
import {
  initAnalytics,
  isAdminPath,
  publicPath,
  resetAnalytics,
  sanitizeProps,
  track,
  usePageViews,
  valueBucketOf,
  type AllowedProps,
} from './analytics';

const scripts = () => document.querySelectorAll<HTMLScriptElement>('script[data-analytics]');

/** Makes the document look like it is still loading, so the `load` event has not fired yet. */
function pretendLoading(): void {
  Object.defineProperty(document, 'readyState', { configurable: true, get: () => 'loading' });
}

function PageViews() {
  usePageViews();
  return null;
}

const renderPageViews = (route: string) =>
  render(
    <MemoryRouter initialEntries={[route]}>
      <PageViews />
    </MemoryRouter>,
  );

beforeEach(() => {
  disableAnalytics();
});

afterEach(() => {
  Reflect.deleteProperty(document, 'readyState');
  window.history.pushState({}, '', '/');
  vi.unstubAllGlobals();
  disableAnalytics();
});

describe('without a provider (GES-133)', () => {
  it('requests no script, creates no data layer and ignores track()', () => {
    vi.stubEnv('VITE_ANALYTICS_PROVIDER', '');
    vi.stubEnv('VITE_GA4_ID', 'G-TEST123');

    initAnalytics();
    track('view_room', { roomSlug: 'principal' });

    expect(scripts()).toHaveLength(0);
    expect(window.dataLayer).toBeUndefined();
  });

  it('stays off when the provider is set but its key is missing', () => {
    vi.stubEnv('VITE_ANALYTICS_PROVIDER', 'ga4');
    vi.stubEnv('VITE_GA4_ID', '');

    track('purchase');

    expect(scripts()).toHaveLength(0);
    expect(window.dataLayer).toBeUndefined();
  });

  it('does not treat a lone VITE_GA4_ID as a provider (supersedes NUC-206 gating)', () => {
    vi.stubEnv('VITE_GA4_ID', 'G-TEST123');

    track('view_room', { roomSlug: 'principal' });

    expect(scripts()).toHaveLength(0);
    expect(window.dataLayer).toBeUndefined();
  });
});

describe('GA4 (GES-134)', () => {
  it('injects gtag.js only after the window load event', () => {
    enableGa4();
    pretendLoading();

    initAnalytics();
    expect(scripts()).toHaveLength(0);

    window.dispatchEvent(new Event('load'));
    expect(scripts()).toHaveLength(1);
    expect(scripts()[0]?.src).toBe('https://www.googletagmanager.com/gtag/js?id=G-TEST123');
  });

  it('configures GA4 without client storage and without automatic page views', () => {
    enableGa4();

    initAnalytics();

    expect(gtagCommands('config')).toEqual([
      [
        'config',
        'G-TEST123',
        expect.objectContaining({ client_storage: 'none', send_page_view: false }),
      ],
    ]);
  });

  it('injects the script once however many events are tracked', () => {
    enableGa4();

    track('view_room', { roomSlug: 'principal' });
    track('select_slot', { roomSlug: 'principal' });
    track('begin_checkout');

    expect(scripts()).toHaveLength(1);
    expect(gtagEvents().map((event) => event.name)).toEqual([
      'view_room',
      'select_slot',
      'begin_checkout',
    ]);
  });
});

describe('PostHog (GES-134)', () => {
  const posthogEnv = () => {
    vi.stubEnv('VITE_ANALYTICS_PROVIDER', 'posthog');
    vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test');
    vi.stubEnv('VITE_POSTHOG_HOST', '');
    resetAnalytics();
  };
  const fakeClient = () => ({ init: vi.fn(), capture: vi.fn() });

  it('loads its script after the load event and initializes in memory persistence', () => {
    posthogEnv();
    pretendLoading();
    const client = fakeClient();
    window.posthog = client;

    initAnalytics();
    expect(scripts()).toHaveLength(0);
    window.dispatchEvent(new Event('load'));
    expect(scripts()[0]?.src).toBe('https://us-assets.i.posthog.com/static/array.js');
    expect(client.init).not.toHaveBeenCalled();
    scripts()[0]?.dispatchEvent(new Event('load'));

    expect(client.init).toHaveBeenCalledWith(
      'phc_test',
      expect.objectContaining({
        api_host: 'https://us.i.posthog.com',
        persistence: 'memory',
        autocapture: false,
        capture_pageview: false,
      }),
    );
    delete window.posthog;
  });

  it('holds events until the script is ready, then sends them in order', () => {
    posthogEnv();
    const client = fakeClient();
    window.posthog = client;

    track('view_room', { roomSlug: 'principal' });
    track('purchase', { paymentMethod: 'pix', valueBucket: '100-300' });
    expect(client.capture).not.toHaveBeenCalled();
    scripts()[0]?.dispatchEvent(new Event('load'));
    track('quote_requested');

    expect(client.capture.mock.calls.map((call: unknown[]) => String(call[0]))).toEqual([
      'view_room',
      'purchase',
      'quote_requested',
    ]);
    expect(client.capture).toHaveBeenNthCalledWith(
      2,
      'purchase',
      expect.objectContaining({ paymentMethod: 'pix', valueBucket: '100-300' }),
    );
    delete window.posthog;
  });
});

describe('property whitelist (GES-135)', () => {
  it('drops everything outside roomSlug, categoryType, paymentMethod and valueBucket', () => {
    const personal = {
      roomSlug: 'principal',
      categoryType: 'hour_package',
      paymentMethod: 'pix',
      valueBucket: '100-300',
      email: 'ana@example.com',
      name: 'Ana Souza',
      phone: '+5547999990001',
      document: '52998224725',
      booking_code: 'BRV-7K2Q9X',
    } as AllowedProps;

    expect(sanitizeProps(personal)).toEqual({
      roomSlug: 'principal',
      categoryType: 'hour_package',
      paymentMethod: 'pix',
      valueBucket: '100-300',
    });
  });

  it('sends only the whitelisted properties to the provider', () => {
    enableGa4();

    track('purchase', {
      paymentMethod: 'pix',
      email: 'ana@example.com',
      name: 'Ana',
    } as AllowedProps);

    const [event] = gtagEvents();
    expect(event?.name).toBe('purchase');
    expect(Object.keys(event?.params ?? {}).sort()).toEqual([
      'page_location',
      'page_path',
      'paymentMethod',
    ]);
  });

  it('buckets the BRL value into the four ranges', () => {
    expect(valueBucketOf(9999)).toBe('<100');
    expect(valueBucketOf(10000)).toBe('100-300');
    expect(valueBucketOf(30000)).toBe('100-300');
    expect(valueBucketOf(30001)).toBe('300-1000');
    expect(valueBucketOf(100000)).toBe('300-1000');
    expect(valueBucketOf(100001)).toBe('>1000');
  });
});

describe('admin suppression (GES-136)', () => {
  it('recognizes only /admin and its sub-paths', () => {
    expect(isAdminPath('/admin')).toBe(true);
    expect(isAdminPath('/admin/financeiro')).toBe(true);
    expect(isAdminPath('/administracao')).toBe(false);
    expect(isAdminPath('/app/admin')).toBe(false);
  });

  it('sends no event while the browser is under /admin', () => {
    enableGa4();
    window.history.pushState({}, '', '/admin/financeiro');

    track('purchase', { paymentMethod: 'pix' });

    expect(gtagEvents()).toEqual([]);
  });

  it('records no page view for an admin route and one per public route', () => {
    enableGa4();

    const admin = renderPageViews('/admin/clientes');
    expect(gtagEvents()).toEqual([]);
    admin.unmount();

    renderPageViews('/salas');
    expect(gtagEvents()).toEqual([
      {
        name: 'page_view',
        params: { page_path: '/salas', page_location: `${window.location.origin}/salas` },
      },
    ]);
  });
});

describe('links with tokens never leave the browser (GES-135)', () => {
  it('replaces ids and tokens in a path and drops query and hash', () => {
    expect(publicPath('/pre-reserva/k3Fa9xQ7mZpL2vN8wT5y')).toBe('/pre-reserva/:id');
    expect(publicPath('/checkout/b1000000-0000-4000-8000-000000000001')).toBe('/checkout/:id');
    expect(publicPath('/salas/principal')).toBe('/salas/principal');
  });

  it('reports the redacted path of a pre-reservation page view', () => {
    enableGa4();

    renderPageViews('/pre-reserva/k3Fa9xQ7mZpL2vN8wT5y?x=1');

    const [event] = gtagEvents();
    expect(event?.params['page_path']).toBe('/pre-reserva/:id');
    expect(JSON.stringify(event)).not.toContain('k3Fa9x');
  });
});
