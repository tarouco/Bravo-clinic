/* Web push handler (GES-82). Loaded by the generated service worker through
 * `workbox.importScripts` (apps/web/pwa.config.ts). Plain JavaScript on purpose: it runs as is in
 * the service worker scope, with no build step.
 *
 * Payload sent by the API (GES-78): { title, body, url, tag }. */

/* global self */

const BRAND_ICON = '/icons/icon-192.png';
const DEFAULT_URL = '/app';

self.addEventListener('push', (event) => {
  let payload = {};
  if (event.data) {
    try {
      payload = event.data.json();
    } catch {
      payload = { body: event.data.text() };
    }
  }

  const title = typeof payload.title === 'string' && payload.title ? payload.title : 'Bravô Clinic';
  const options = {
    body: typeof payload.body === 'string' ? payload.body : '',
    icon: BRAND_ICON,
    data: { url: typeof payload.url === 'string' && payload.url ? payload.url : DEFAULT_URL },
  };
  if (typeof payload.tag === 'string' && payload.tag) options.tag = payload.tag;

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url =
    event.notification.data && typeof event.notification.data.url === 'string'
      ? event.notification.data.url
      : DEFAULT_URL;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      // Reuse an open app window; open the payload URL only when there is none.
      const open = windows.find((client) => typeof client.focus === 'function');
      return open ? open.focus() : self.clients.openWindow(url);
    }),
  );
});
