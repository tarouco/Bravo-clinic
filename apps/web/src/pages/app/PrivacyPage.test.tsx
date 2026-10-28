import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSession } from '../../features/auth/useSession';
import { consents } from '../../features/privacy/fixtures';
import { me } from '../../test/fixtures/nucleo';
import { apiError } from '../../test/msw/handlers';
import { server } from '../../test/msw/server';
import { renderWithProviders } from '../../test/render-with-providers';
import { PrivacyPage } from './PrivacyPage';

// Only `Date` is faked, so timers, MSW and Testing Library keep running normally.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-26T15:00:00Z'));
  server.use(
    http.get('*/api/app/me/consents', () => HttpResponse.json(consents)),
    http.get('*/api/app/me', () => HttpResponse.json(me)),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

/** Shows the cached session so a test can see it dropped. */
function SessionProbe() {
  const { session } = useSession();
  return <output data-testid="session">{session ? session.name : 'anônimo'}</output>;
}

function renderPage() {
  return renderWithProviders(
    <>
      <Routes>
        <Route path="/app/perfil/privacidade" element={<PrivacyPage />} />
        <Route path="/" element={<p>página inicial</p>} />
      </Routes>
      <SessionProbe />
    </>,
    '/app/perfil/privacidade',
  );
}

const openDeletion = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await screen.findByRole('button', { name: 'Excluir minha conta' }));
  return screen.getByRole('dialog', { name: 'Excluir minha conta' });
};

describe('PrivacyPage consents (GES-128)', () => {
  it('lists each consent with its kind label, version and São Paulo date', async () => {
    renderPage();

    const policy = (await screen.findByText('Política de reservas')).closest('li') as HTMLElement;
    expect(within(policy).getByText('Versão policy-v2 · 18/10/2026')).toBeInTheDocument();
    const recurring = screen
      .getByText('Cobrança recorrente no cartão')
      .closest('li') as HTMLElement;
    // 2026-10-20T02:15Z is still the 19th in São Paulo.
    expect(
      within(recurring).getByText('Versão recurring-2026-10 · 19/10/2026'),
    ).toBeInTheDocument();
  });

  it('says so when there is no consent yet', async () => {
    server.use(http.get('*/api/app/me/consents', () => HttpResponse.json({ items: [] })));
    renderPage();

    expect(await screen.findByText('Nenhum aceite registrado.')).toBeInTheDocument();
  });
});

describe('PrivacyPage data export (GES-128)', () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:export');
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => {
    Reflect.deleteProperty(URL, 'createObjectURL');
    Reflect.deleteProperty(URL, 'revokeObjectURL');
  });

  it('downloads the API export under the dated file name', async () => {
    let requested: string | null = null;
    server.use(
      http.get('*/api/app/me/data-export', ({ request }) => {
        requested = new URL(request.url).pathname;
        return HttpResponse.json({ profile: {} });
      }),
    );
    const saved: { download: string; href: string }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      saved.push({ download: this.download, href: this.href });
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Baixar meus dados' }));

    await waitFor(() => expect(saved).toHaveLength(1));
    expect(requested).toBe('/api/app/me/data-export');
    expect(saved[0]).toEqual({ download: 'bravo-meus-dados-2026-10-26.json', href: 'blob:export' });
  });

  it('shows the API message when the daily export limit is reached', async () => {
    server.use(
      http.get('*/api/app/me/data-export', () =>
        apiError(429, 'TOO_MANY_ATTEMPTS', 'Você já baixou seus dados 3 vezes hoje.'),
      ),
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Baixar meus dados' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Você já baixou seus dados 3 vezes hoje.',
    );
  });
});

describe('PrivacyPage account deletion (GES-124..GES-126, GES-128)', () => {
  it('describes what is erased and what is kept, and needs the password to enable the button', async () => {
    const user = userEvent.setup();
    renderPage();

    const dialog = await openDeletion(user);

    expect(within(dialog).getByText(/Será apagado:/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Será mantido, sem identificar você:/)).toBeInTheDocument();
    const confirm = within(dialog).getByRole('button', { name: 'Excluir minha conta' });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByLabelText('Senha atual'), 'Senha-Forte-1');
    expect(confirm).toBeEnabled();
  });

  it('posts the password, drops the session and leaves for the home page', async () => {
    const bodies: Record<string, unknown>[] = [];
    server.use(
      http.post('*/api/app/me/deletion', async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({});
      }),
    );
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(me.name);
    expect(screen.getByTestId('session')).toHaveTextContent(me.name);
    const dialog = await openDeletion(user);

    await user.type(within(dialog).getByLabelText('Senha atual'), 'Senha-Forte-1');
    await user.click(within(dialog).getByRole('button', { name: 'Excluir minha conta' }));

    expect(await screen.findByText('página inicial')).toBeInTheDocument();
    expect(bodies).toEqual([{ password: 'Senha-Forte-1' }]);
    expect(screen.getByTestId('session')).toHaveTextContent('anônimo');
    expect(screen.getByText('Sua conta foi excluída.')).toBeInTheDocument();
  });

  it('asks Google-only accounts to type EXCLUIR instead of a password', async () => {
    const bodies: Record<string, unknown>[] = [];
    server.use(
      http.post('*/api/app/me/deletion', async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({});
      }),
    );
    const user = userEvent.setup();
    renderPage();
    const dialog = await openDeletion(user);

    await user.click(within(dialog).getByRole('checkbox', { name: /login com Google/ }));
    expect(within(dialog).queryByLabelText('Senha atual')).not.toBeInTheDocument();
    const confirm = within(dialog).getByRole('button', { name: 'Excluir minha conta' });
    await user.type(within(dialog).getByLabelText('Digite EXCLUIR para confirmar'), 'excluir');
    expect(confirm).toBeDisabled();
    await user.clear(within(dialog).getByLabelText('Digite EXCLUIR para confirmar'));
    await user.type(within(dialog).getByLabelText('Digite EXCLUIR para confirmar'), 'EXCLUIR');
    await user.click(confirm);

    expect(await screen.findByText('página inicial')).toBeInTheDocument();
    expect(bodies).toEqual([{ confirmText: 'EXCLUIR' }]);
  });

  it('lists the open bookings and subscriptions of a 409 and keeps the session', async () => {
    server.use(
      http.post('*/api/app/me/deletion', () =>
        HttpResponse.json(
          {
            error: {
              code: 'HAS_ACTIVE_COMMITMENTS',
              message: 'Você tem compromissos em aberto.',
              details: {
                bookings: [{ code: 'BRV-7K2Q9X' }],
                subscriptions: [{ id: 'sub-1' }],
              },
            },
          },
          { status: 409 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(me.name);
    const dialog = await openDeletion(user);

    await user.type(within(dialog).getByLabelText('Senha atual'), 'Senha-Forte-1');
    await user.click(within(dialog).getByRole('button', { name: 'Excluir minha conta' }));

    const list = await within(dialog).findByRole('list', { name: 'Compromissos em aberto' });
    expect(within(list).getByText('Reserva BRV-7K2Q9X')).toBeInTheDocument();
    expect(within(list).getByText('Assinatura sub-1')).toBeInTheDocument();
    expect(within(dialog).getByText('Você tem compromissos em aberto.')).toBeInTheDocument();
    expect(screen.getByTestId('session')).toHaveTextContent(me.name);
    expect(screen.queryByText('página inicial')).not.toBeInTheDocument();
  });

  it('keeps the dialog open with a message when the password is wrong', async () => {
    server.use(
      http.post('*/api/app/me/deletion', () =>
        apiError(401, 'INVALID_CREDENTIALS', 'Credenciais inválidas.'),
      ),
    );
    const user = userEvent.setup();
    renderPage();
    const dialog = await openDeletion(user);

    await user.type(within(dialog).getByLabelText('Senha atual'), 'errada');
    await user.click(within(dialog).getByRole('button', { name: 'Excluir minha conta' }));

    expect(
      await within(dialog).findByText('Senha incorreta. Tente novamente.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('página inicial')).not.toBeInTheDocument();
  });
});
