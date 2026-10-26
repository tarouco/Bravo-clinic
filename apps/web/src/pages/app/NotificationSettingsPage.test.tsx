import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiError } from '../../test/msw/handlers';
import { server } from '../../test/msw/server';
import { renderWithProviders } from '../../test/render-with-providers';
import { NotificationSettingsPage, PUSH_EXPLANATIONS } from './NotificationSettingsPage';

const VAPID_KEY =
  'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';
const ENDPOINT = 'https://push.example.com/send/abc123';

type Permission = 'default' | 'granted' | 'denied';

interface BrowserOptions {
  /** Leave the push APIs out entirely (an old browser). */
  unsupported?: boolean;
  permission?: Permission;
  /** What `Notification.requestPermission()` answers. */
  asked?: Permission;
  /** The browser already holds a push subscription. */
  subscribed?: boolean;
  userAgent?: string;
  standalone?: boolean;
}

function fakeSubscription() {
  return {
    endpoint: ENDPOINT,
    toJSON: () => ({
      endpoint: ENDPOINT,
      expirationTime: null,
      keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA', auth: 'tBHItJI5svbpez7KI4CCXg' },
    }),
    unsubscribe: vi.fn().mockResolvedValue(true),
  };
}

/** Stubs the browser push APIs; returns the spies the tests assert on. */
function stubBrowser(options: BrowserOptions = {}) {
  const subscription = fakeSubscription();
  let current: ReturnType<typeof fakeSubscription> | null = options.subscribed
    ? subscription
    : null;
  const subscribe = vi.fn().mockImplementation(() => {
    current = subscription;
    return Promise.resolve(subscription);
  });
  const requestPermission = vi.fn().mockResolvedValue(options.asked ?? 'granted');
  if (!options.unsupported) {
    vi.stubGlobal('PushManager', class PushManager {});
    vi.stubGlobal('Notification', {
      permission: options.permission ?? 'default',
      requestPermission,
    });
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        ready: Promise.resolve({
          pushManager: { subscribe, getSubscription: () => Promise.resolve(current) },
        }),
      },
    });
  }
  if (options.userAgent) {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(options.userAgent);
  }
  if (options.standalone) {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );
  }
  return { subscription, subscribe, requestPermission };
}

interface ApiCalls {
  posts: Record<string, unknown>[];
  deletes: Record<string, unknown>[];
}

function stubApi(vapidPublicKey: string | null = VAPID_KEY, postFails = false): ApiCalls {
  const calls: ApiCalls = { posts: [], deletes: [] };
  server.use(
    http.get('*/api/public/config', () =>
      HttpResponse.json({ googleEnabled: false, whatsappE164: '+5547999990000', vapidPublicKey }),
    ),
    http.post('*/api/app/push/subscriptions', async ({ request }) => {
      calls.posts.push((await request.json()) as Record<string, unknown>);
      return postFails
        ? apiError(500, 'INTERNAL', 'Erro interno.')
        : HttpResponse.json({}, { status: 201 });
    }),
    http.delete('*/api/app/push/subscriptions', async ({ request }) => {
      calls.deletes.push((await request.json()) as Record<string, unknown>);
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return calls;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'serviceWorker');
});

const enableButton = () => screen.findByRole('button', { name: 'Ativar notificações' });
const noButtons = () => {
  expect(screen.queryByRole('button', { name: 'Ativar notificações' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Desativar' })).not.toBeInTheDocument();
};

describe('NotificationSettingsPage enable and disable (GES-83)', () => {
  it('asks permission, subscribes with the VAPID key, posts the subscription and offers "Desativar"', async () => {
    const browser = stubBrowser();
    const calls = stubApi();
    const user = userEvent.setup();
    renderWithProviders(<NotificationSettingsPage />, '/app/perfil/notificacoes');

    await user.click(await enableButton());

    expect(await screen.findByRole('button', { name: 'Desativar' })).toBeInTheDocument();
    expect(browser.requestPermission).toHaveBeenCalledTimes(1);
    expect(browser.subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: new Uint8Array(Buffer.from(VAPID_KEY, 'base64url')),
    });
    expect(calls.posts).toEqual([
      {
        endpoint: ENDPOINT,
        keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA', auth: 'tBHItJI5svbpez7KI4CCXg' },
      },
    ]);
  });

  it('starts as "Desativar" when the browser is already subscribed, and removes it on click', async () => {
    const browser = stubBrowser({ permission: 'granted', subscribed: true });
    const calls = stubApi();
    const user = userEvent.setup();
    renderWithProviders(<NotificationSettingsPage />, '/app/perfil/notificacoes');

    await user.click(await screen.findByRole('button', { name: 'Desativar' }));

    expect(await enableButton()).toBeInTheDocument();
    expect(calls.deletes).toEqual([{ endpoint: ENDPOINT }]);
    expect(browser.subscription.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('explains the block when the user refuses the permission prompt', async () => {
    stubBrowser({ asked: 'denied' });
    const calls = stubApi();
    const user = userEvent.setup();
    renderWithProviders(<NotificationSettingsPage />, '/app/perfil/notificacoes');

    await user.click(await enableButton());

    expect(await screen.findByText(PUSH_EXPLANATIONS.denied ?? '')).toBeInTheDocument();
    noButtons();
    expect(calls.posts).toHaveLength(0);
  });

  it('drops the browser subscription and shows the error when the API refuses it', async () => {
    const browser = stubBrowser();
    stubApi(VAPID_KEY, true);
    const user = userEvent.setup();
    renderWithProviders(<NotificationSettingsPage />, '/app/perfil/notificacoes');

    await user.click(await enableButton());

    expect(await screen.findByRole('alert')).toHaveTextContent('Erro interno.');
    expect(browser.subscription.unsubscribe).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Ativar notificações' })).toBeInTheDocument();
  });
});

describe('NotificationSettingsPage explanations instead of the button (GES-83)', () => {
  it('says the browser has no push support', async () => {
    stubBrowser({ unsupported: true });
    stubApi();
    renderWithProviders(<NotificationSettingsPage />, '/app/perfil/notificacoes');

    expect(await screen.findByText(PUSH_EXPLANATIONS.unsupported ?? '')).toBeInTheDocument();
    noButtons();
  });

  it('says the permission is denied', async () => {
    stubBrowser({ permission: 'denied' });
    stubApi();
    renderWithProviders(<NotificationSettingsPage />, '/app/perfil/notificacoes');

    expect(await screen.findByText(PUSH_EXPLANATIONS.denied ?? '')).toBeInTheDocument();
    noButtons();
  });

  it('asks an iPhone outside the installed app to install it first', async () => {
    stubBrowser({
      unsupported: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15',
    });
    stubApi();
    renderWithProviders(<NotificationSettingsPage />, '/app/perfil/notificacoes');

    expect(
      await screen.findByText(PUSH_EXPLANATIONS['ios-not-installed'] ?? ''),
    ).toBeInTheDocument();
    expect(PUSH_EXPLANATIONS['ios-not-installed']).toMatch(/Adicionar à Tela de Início/);
    noButtons();
  });

  it('offers the button on an iPhone once the app runs installed', async () => {
    stubBrowser({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15',
      standalone: true,
    });
    stubApi();
    renderWithProviders(<NotificationSettingsPage />, '/app/perfil/notificacoes');

    expect(await enableButton()).toBeInTheDocument();
  });

  it('shows no button when the clinic has no VAPID public key', async () => {
    stubBrowser();
    stubApi(null);
    renderWithProviders(<NotificationSettingsPage />, '/app/perfil/notificacoes');

    expect(await screen.findByText(PUSH_EXPLANATIONS.unavailable ?? '')).toBeInTheDocument();
    noButtons();
  });

  it('does not decide anything before the config answers', async () => {
    stubBrowser();
    server.use(http.get('*/api/public/config', () => new Promise<Response>(() => undefined)));
    renderWithProviders(<NotificationSettingsPage />, '/app/perfil/notificacoes');

    expect(
      await screen.findByRole('status', { name: 'Verificando notificações' }),
    ).toBeInTheDocument();
    await waitFor(() => noButtons());
  });
});
