import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '../../features/auth/useSession';
import { renderWithProviders } from '../../test/render-with-providers';
import { AppShell } from './AppShell';

const tenant: Session = {
  id: 'u1',
  name: 'Ana Souza',
  email: 'ana@example.com',
  role: 'tenant',
  emailVerified: true,
  docType: 'cpf',
  mfa: { enrolled: false, verified: false },
};

const EXPECTED_NAV = [
  ['Reservar', '/app/reservar'],
  ['Minhas reservas', '/app/minhas-reservas'],
  ['Agenda', '/app/agenda'],
  ['Compras', '/app/compras'],
  ['Perfil', '/app/perfil'],
] as const;

function json(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Answers `/api/app/me` with the session; other calls go to `handler` (default 204). */
function stubApi(session: Session, handler: (url: string) => Response = () => json(204)) {
  const fetchMock = vi
    .fn()
    .mockImplementation((url: string) =>
      Promise.resolve(url === '/api/app/me' ? json(200, session) : handler(url)),
    );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function Where() {
  const location = useLocation();
  return <p data-testid="where">{location.pathname}</p>;
}

function renderShell(route = '/app/agenda') {
  return renderWithProviders(
    <Routes>
      <Route path="app" element={<AppShell />}>
        <Route index element={<p>Conteúdo do app</p>} />
        <Route path="agenda" element={<p>Conteúdo da agenda</p>} />
      </Route>
      <Route path="*" element={<Where />} />
    </Routes>,
    route,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AppShell navigation', () => {
  it('lists Reservar, Minhas reservas, Agenda, Compras and Perfil in order in the sidebar and the tab bar', async () => {
    stubApi(tenant);
    renderShell();
    await screen.findByText('Conteúdo da agenda');

    const sidebar = screen.getByRole('navigation', { name: 'Menu lateral' });
    const tabBar = screen.getByRole('navigation', { name: 'Menu inferior' });
    for (const nav of [sidebar, tabBar]) {
      const links = within(nav).getAllByRole('link');
      expect(links.map((link) => link.textContent)).toEqual(EXPECTED_NAV.map(([label]) => label));
      expect(links.map((link) => link.getAttribute('href'))).toEqual(
        EXPECTED_NAV.map(([, path]) => path),
      );
    }
  });

  it('shows the tab bar only below lg and the sidebar only from lg', async () => {
    stubApi(tenant);
    renderShell();
    await screen.findByText('Conteúdo da agenda');

    expect(screen.getByRole('navigation', { name: 'Menu inferior' })).toHaveClass('lg:hidden');
    const sidebar = screen.getByRole('navigation', { name: 'Menu lateral' });
    expect(sidebar).toHaveClass('hidden');
    expect(sidebar).toHaveClass('lg:flex');
  });

  it('renders the matched child route inside the shell', async () => {
    stubApi(tenant);
    renderShell('/app');

    expect(await screen.findByText('Conteúdo do app')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Menu lateral' })).toBeInTheDocument();
  });
});

describe('AppShell header', () => {
  it('shows the brand, the first name of the user and the theme toggle', async () => {
    stubApi(tenant);
    renderShell();

    expect(await screen.findByText('Olá, Ana')).toBeInTheDocument();
    const header = screen.getByRole('banner');
    expect(within(header).getByText('BRAVÔ CLINIC')).toBeInTheDocument();
    expect(within(header).getByRole('button', { name: 'Alternar tema' })).toBeInTheDocument();
  });

  it('calls logout and navigates to / when "Sair" is clicked', async () => {
    const fetchMock = stubApi(tenant);
    const user = userEvent.setup();
    renderShell();

    await user.click(await screen.findByRole('button', { name: 'Sair' }));

    expect(await screen.findByTestId('where')).toHaveTextContent(/^\/$/);
    const logoutCall = fetchMock.mock.calls.find(([url]) => url === '/api/app/auth/logout') as
      [string, RequestInit] | undefined;
    expect(logoutCall?.[1].method).toBe('POST');
  });

  it('stays in the app and shows an error when logout fails', async () => {
    stubApi(tenant, () => json(500, { error: { code: 'INTERNAL', message: 'x' } }));
    const user = userEvent.setup();
    renderShell();

    await user.click(await screen.findByRole('button', { name: 'Sair' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível sair. Tente novamente.',
    );
    expect(screen.queryByTestId('where')).not.toBeInTheDocument();
    expect(screen.getByText('Conteúdo da agenda')).toBeInTheDocument();
  });
});

describe('AppShell e-mail banner', () => {
  it('asks an unverified user to confirm the e-mail and resends the link', async () => {
    const fetchMock = stubApi({ ...tenant, emailVerified: false });
    const user = userEvent.setup();
    renderShell();

    expect(await screen.findByText('Confirme seu e-mail para reservar.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reenviar e-mail' }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.map(([url]) => url as string)).toContain(
        '/api/app/auth/verify-email/resend',
      ),
    );
    expect(await screen.findByText('Enviamos um novo link para o seu e-mail.')).toBeInTheDocument();
  });

  it('shows no banner for a verified user', async () => {
    stubApi(tenant);
    renderShell();
    await screen.findByText('Olá, Ana');

    expect(screen.queryByText('Confirme seu e-mail para reservar.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reenviar e-mail' })).not.toBeInTheDocument();
  });
});
