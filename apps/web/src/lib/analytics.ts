import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

// Cookieless funnel analytics (GES-133..GES-136, supersedes the GA4-only gate of NUC-206).
//
// `VITE_ANALYTICS_PROVIDER` is `posthog` or `ga4`; with the provider unset (or its key missing)
// no script is requested and `track()` does nothing. The provider script loads after the window
// `load` event, never stores cookies or local storage, and only the properties listed in
// `ALLOWED_PROPS` ever leave the browser: no name, e-mail, phone, document or booking code.

export type FunnelEvent =
  | 'page_view'
  | 'view_room'
  | 'select_slot'
  | 'begin_checkout'
  | 'purchase'
  | 'subscription_purchased'
  | 'quote_requested'
  | 'signup_completed';

/** `valueBucket`: the BRL amount in one of four ranges, never the exact value. */
export type ValueBucket = '<100' | '100-300' | '300-1000' | '>1000';

export interface AllowedProps {
  roomSlug?: string | undefined;
  categoryType?: string | undefined;
  paymentMethod?: string | undefined;
  valueBucket?: ValueBucket | undefined;
}

const ALLOWED_PROPS = ['roomSlug', 'categoryType', 'paymentMethod', 'valueBucket'] as const;

/** 0..99.99 -> "<100", up to 300 -> "100-300", up to 1000 -> "300-1000", above -> ">1000". */
export function valueBucketOf(cents: number): ValueBucket {
  const reais = cents / 100;
  if (reais < 100) return '<100';
  if (reais <= 300) return '100-300';
  if (reais <= 1000) return '300-1000';
  return '>1000';
}

/** Keeps only the whitelisted properties that carry a value. */
export function sanitizeProps(props: object): Record<string, string> {
  const source = props as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const key of ALLOWED_PROPS) {
    const value = source[key];
    if (typeof value === 'string' && value !== '') out[key] = value;
  }
  return out;
}

const OPAQUE_SEGMENT =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|(?=.*\d)[A-Za-z0-9_-]{16,})$/i;

/** The path without query or hash, with ids and tokens (pre-reservation links...) replaced by ":id". */
export function publicPath(pathname: string): string {
  return pathname
    .split('/')
    .map((segment) => (OPAQUE_SEGMENT.test(segment) ? ':id' : segment))
    .join('/');
}

/** The admin area never reports anything (GES-136). */
export function isAdminPath(pathname: string): boolean {
  return pathname === '/admin' || pathname.startsWith('/admin/');
}

// ---- Configuration ----

export interface AnalyticsEnv {
  provider?: string | undefined;
  ga4Id?: string | undefined;
  posthogKey?: string | undefined;
  posthogHost?: string | undefined;
}

type Config = { provider: 'ga4'; id: string } | { provider: 'posthog'; key: string; host: string };

const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com';

function envValue(name: string): string | undefined {
  const value: unknown = import.meta.env[name];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function readEnv(): AnalyticsEnv {
  return {
    provider: envValue('VITE_ANALYTICS_PROVIDER'),
    ga4Id: envValue('VITE_GA4_ID'),
    posthogKey: envValue('VITE_POSTHOG_KEY'),
    posthogHost: envValue('VITE_POSTHOG_HOST'),
  };
}

function resolveConfig(env: AnalyticsEnv): Config | null {
  if (env.provider === 'ga4' && env.ga4Id) return { provider: 'ga4', id: env.ga4Id };
  if (env.provider === 'posthog' && env.posthogKey) {
    return {
      provider: 'posthog',
      key: env.posthogKey,
      host: (env.posthogHost ?? DEFAULT_POSTHOG_HOST).replace(/\/+$/, ''),
    };
  }
  return null;
}

const configKey = (config: Config): string =>
  config.provider === 'ga4' ? `ga4:${config.id}` : `posthog:${config.key}@${config.host}`;

// ---- Providers ----

interface PostHogLike {
  init: (key: string, options: Record<string, unknown>) => void;
  capture: (event: string, props?: Record<string, unknown>) => void;
}

declare global {
  interface Window {
    dataLayer?: unknown[];
    posthog?: PostHogLike;
  }
}

const SCRIPT_ATTRIBUTE = 'data-analytics';

function injectScript(src: string, provider: string, onLoad?: () => void): void {
  if (document.querySelector(`script[${SCRIPT_ATTRIBUTE}]`)) return;
  const script = document.createElement('script');
  script.async = true;
  script.src = src;
  script.setAttribute(SCRIPT_ATTRIBUTE, provider);
  if (onLoad) script.addEventListener('load', onLoad, { once: true });
  document.head.appendChild(script);
}

/** Runs `callback` once the window has loaded, so analytics never competes with the first paint. */
function afterLoad(callback: () => void): void {
  if (document.readyState === 'complete') callback();
  else window.addEventListener('load', callback, { once: true });
}

/** "https://us.i.posthog.com" -> "https://us-assets.i.posthog.com", where the loader lives. */
function posthogAssetsHost(host: string): string {
  return host.replace(/^(https:\/\/[a-z0-9]+)\.i\.posthog\.com$/, '$1-assets.i.posthog.com');
}

interface Started {
  key: string;
  config: Config;
  /** PostHog only: events recorded before its script finished loading. */
  pending: { event: string; props: Record<string, unknown> }[];
  ready: boolean;
}

let started: Started | null = null;

/** Clears the module state; tests only. */
export function resetAnalytics(): void {
  started = null;
}

function startGa4(id: string): void {
  const layer = (window.dataLayer ??= []);
  // gtag.js reads `Arguments` objects from the data layer, so commands go through `arguments`.
  const gtag = function (this: void) {
    // eslint-disable-next-line prefer-rest-params
    layer.push(arguments);
  } as (...args: unknown[]) => void;
  gtag('js', new Date());
  gtag('config', id, {
    client_storage: 'none',
    send_page_view: false,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  });
  afterLoad(() => {
    injectScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`, 'ga4');
  });
}

function startPostHog(state: Started, config: Extract<Config, { provider: 'posthog' }>): void {
  afterLoad(() => {
    injectScript(`${posthogAssetsHost(config.host)}/static/array.js`, 'posthog', () => {
      const client = window.posthog;
      if (!client) return;
      client.init(config.key, {
        api_host: config.host,
        persistence: 'memory',
        autocapture: false,
        capture_pageview: false,
        capture_pageleave: false,
        disable_session_recording: true,
        person_profiles: 'never',
        // Links carry tokens (pre-reservation, password reset): the URL never leaves as is.
        sanitize_properties: (props: Record<string, unknown>) => ({
          ...props,
          $current_url: undefined,
          $referrer: undefined,
          $pathname: undefined,
          $host: undefined,
        }),
      });
      state.ready = true;
      for (const { event, props } of state.pending) client.capture(event, props);
      state.pending = [];
    });
  });
}

function start(config: Config): Started {
  const key = configKey(config);
  if (started?.key === key) return started;
  const state: Started = { key, config, pending: [], ready: false };
  started = state;
  if (config.provider === 'ga4') startGa4(config.id);
  else startPostHog(state, config);
  return state;
}

/**
 * Starts the configured provider (no-op without one). Call once at startup; `track()` also starts
 * it on first use, so tests and late callers need no ordering.
 */
export function initAnalytics(env: AnalyticsEnv = readEnv()): void {
  const config = resolveConfig(env);
  if (config) start(config);
}

function send(event: FunnelEvent, props: Record<string, string>, pathname: string): void {
  const config = resolveConfig(readEnv());
  if (config === null || isAdminPath(pathname)) return;
  const state = start(config);
  const path = publicPath(pathname);

  if (state.config.provider === 'ga4') {
    const layer = (window.dataLayer ??= []);
    const gtag = function (this: void) {
      // eslint-disable-next-line prefer-rest-params
      layer.push(arguments);
    } as (...args: unknown[]) => void;
    gtag('event', event, {
      ...props,
      page_path: path,
      page_location: `${window.location.origin}${path}`,
    });
    return;
  }

  const payload = { ...props, page_path: path };
  if (state.ready && window.posthog) window.posthog.capture(event, payload);
  else state.pending.push({ event, props: payload });
}

/** Records a funnel event; does nothing without a provider and never in `/admin`. */
export function track(event: FunnelEvent, props: AllowedProps = {}): void {
  send(event, sanitizeProps(props), window.location.pathname);
}

/** Records `page_view` on every client-side navigation outside the admin area. */
export function usePageViews(): void {
  const { pathname } = useLocation();
  useEffect(() => {
    if (isAdminPath(pathname)) return;
    send('page_view', {}, pathname);
  }, [pathname]);
}
