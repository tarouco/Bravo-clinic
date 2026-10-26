import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { pwaOptions } from '../../pwa.config';

// Vitest runs with the workspace (apps/web) as cwd.
const SOURCE = readFileSync(resolve(process.cwd(), 'public', 'push-sw.js'), 'utf8');

type Listener = (event: Record<string, unknown>) => void;

interface FakeClient {
  focus: ReturnType<typeof vi.fn>;
}

/** Runs push-sw.js in a fake service worker scope and returns its listeners and spies. */
function loadWorker(windows: FakeClient[] = []) {
  const listeners = new Map<string, Listener>();
  const showNotification = vi.fn().mockResolvedValue(undefined);
  const openWindow = vi.fn().mockResolvedValue(null);
  const matchAll = vi.fn().mockResolvedValue(windows);
  const self = {
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
    registration: { showNotification },
    clients: { matchAll, openWindow },
  };
  runInNewContext(SOURCE, { self });
  return { listeners, showNotification, openWindow, matchAll };
}

/** Delivers a push event and returns the promise handed to `waitUntil`. */
async function deliverPush(
  worker: ReturnType<typeof loadWorker>,
  data: { json: () => unknown; text: () => string } | null,
) {
  const waitUntil = vi.fn();
  worker.listeners.get('push')?.({ data, waitUntil });
  await Promise.all(waitUntil.mock.calls.map(([promise]) => promise as Promise<unknown>));
  return waitUntil;
}

async function deliverClick(worker: ReturnType<typeof loadWorker>, data: unknown) {
  const close = vi.fn();
  const waitUntil = vi.fn();
  worker.listeners.get('notificationclick')?.({ notification: { close, data }, waitUntil });
  await Promise.all(waitUntil.mock.calls.map(([promise]) => promise as Promise<unknown>));
  return close;
}

describe('push event (GES-82)', () => {
  it('shows the payload title and body with the brand icon, tag and target url', async () => {
    const worker = loadWorker();
    const payload = {
      title: 'Reserva confirmada',
      body: 'Sala Principal, 27/10 às 17:30',
      url: '/app/minhas-reservas/b1',
      tag: 'booking-b1',
    };

    const waitUntil = await deliverPush(worker, {
      json: () => payload,
      text: () => JSON.stringify(payload),
    });

    expect(waitUntil).toHaveBeenCalledTimes(1);
    expect(worker.showNotification).toHaveBeenCalledWith('Reserva confirmada', {
      body: 'Sala Principal, 27/10 às 17:30',
      icon: '/icons/icon-192.png',
      tag: 'booking-b1',
      data: { url: '/app/minhas-reservas/b1' },
    });
  });

  it('falls back to the brand name and /app for a payload without title or url', async () => {
    const worker = loadWorker();

    await deliverPush(worker, { json: () => ({ body: 'Novidade' }), text: () => '' });

    expect(worker.showNotification).toHaveBeenCalledWith('Bravô Clinic', {
      body: 'Novidade',
      icon: '/icons/icon-192.png',
      data: { url: '/app' },
    });
  });

  it('shows plain-text payloads as the body', async () => {
    const worker = loadWorker();

    await deliverPush(worker, {
      json: () => {
        throw new SyntaxError('not json');
      },
      text: () => 'Seu pagamento foi aprovado',
    });

    expect(worker.showNotification).toHaveBeenCalledWith(
      'Bravô Clinic',
      expect.objectContaining({ body: 'Seu pagamento foi aprovado' }),
    );
  });
});

describe('notificationclick (GES-82)', () => {
  it('opens the payload url when no app window is open', async () => {
    const worker = loadWorker([]);

    const close = await deliverClick(worker, { url: '/app/minhas-reservas/b1' });

    expect(close).toHaveBeenCalledTimes(1);
    expect(worker.matchAll).toHaveBeenCalledWith({ type: 'window', includeUncontrolled: true });
    expect(worker.openWindow).toHaveBeenCalledWith('/app/minhas-reservas/b1');
  });

  it('focuses an open app window instead of opening another', async () => {
    const open: FakeClient = { focus: vi.fn().mockResolvedValue(undefined) };
    const worker = loadWorker([open]);

    await deliverClick(worker, { url: '/app/minhas-reservas/b1' });

    expect(open.focus).toHaveBeenCalledTimes(1);
    expect(worker.openWindow).not.toHaveBeenCalled();
  });

  it('opens /app when the notification carries no url', async () => {
    const worker = loadWorker([]);

    await deliverClick(worker, undefined);

    expect(worker.openWindow).toHaveBeenCalledWith('/app');
  });
});

describe('service worker wiring (GES-82)', () => {
  it('imports push-sw.js into the generated worker', () => {
    expect(pwaOptions.workbox?.importScripts).toEqual(['push-sw.js']);
  });
});
