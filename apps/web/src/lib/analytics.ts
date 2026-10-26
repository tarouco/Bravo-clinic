// Booking funnel analytics (NUC-206). Provider-agnostic `track()`; GA4 loads only when
// `VITE_GA4_ID` is set, otherwise every call is a no-op and no script is injected.

export type TrackEvent = 'view_room' | 'select_slot' | 'begin_checkout' | 'purchase';

declare global {
  interface Window {
    dataLayer?: unknown[];
  }
}

const SCRIPT_ATTRIBUTE = 'data-ga4';

function measurementId(): string | null {
  const id: unknown = import.meta.env['VITE_GA4_ID'];
  return typeof id === 'string' && id.trim() !== '' ? id.trim() : null;
}

/** Defines `gtag` on first use and injects the single gtag.js script. */
function ensureGtag(id: string): unknown[] {
  const layer = (window.dataLayer ??= []);
  if (!document.querySelector(`script[${SCRIPT_ATTRIBUTE}]`)) {
    // gtag.js reads `Arguments` objects from the data layer, so the init commands use `arguments`.
    const gtag = function (this: void) {
      // eslint-disable-next-line prefer-rest-params
      layer.push(arguments);
    } as (...args: unknown[]) => void;
    gtag('js', new Date());
    gtag('config', id);
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
    script.setAttribute(SCRIPT_ATTRIBUTE, id);
    document.head.appendChild(script);
  }
  return layer;
}

/** Pushes `event` with `props` to `window.dataLayer` when GA4 is configured. */
export function track(event: TrackEvent, props: Record<string, unknown> = {}): void {
  const id = measurementId();
  if (id === null) return;
  ensureGtag(id).push({ event, ...props });
}
