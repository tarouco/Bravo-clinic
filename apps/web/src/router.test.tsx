import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation, useRoutes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from './components/ui/Toast';
import type { Session } from './features/auth/useSession';
import { createQueryClient } from './lib/query-client';
import { appRoutes } from './router';
import { ThemeProvider } from './theme/ThemeProvider';

const base: Session = {
  id: 'u1',
  name: 'Ana Souza',
  email: 'ana@example.com',
  role: 'tenant',
  emailVerified: true,
  docType: 'cpf',
  mfa: { enrolled: false, verified: false },
};

const admin = (mfa: Session['mfa']): Session => ({ ...base, role: 'admin', mfa });
const reception = (mfa: Session['mfa']): Session => ({ ...base, role: 'reception', mfa });

/** Answers `/api/app/me` with the session (or 401 when anonymous); everything else is a 404. */
function stubApi(session: Session | null) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string) => {
      if (url === '/api/app/me') {
        return Promise.resolve(
          session
            ? new Response(JSON.stringify(session), { status: 200 })
            : new Response(JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'x' } }), {
                status: 401,
              }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'x' } }), {
          status: 404,
        }),
      );
    }),
  );
}

let currentLocation = '';

/** Renders the real route table in a memory router (jsdom cannot run the data router's Request). */
function RouteTable() {
  const location = useLocation();
  currentLocation = `${location.pathname}${location.search}`;
  return useRoutes(appRoutes);
}

function renderRoute(path: string) {
  render(
    <ThemeProvider>
      <QueryClientProvider client={createQueryClient()}>
        <ToastProvider>
          <MemoryRouter
            initialEntries={[path]}
            future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
          >
            <RouteTable />
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

const locationOf = () => currentLocation;

beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('route guards', () => {
  it('sends an anonymous visitor of /app/agenda to /login with the encoded next path', async () => {
    stubApi(null);
    renderRoute('/app/agenda');

    await waitFor(() => expect(locationOf()).toBe('/login?next=%2Fapp%2Fagenda'));
  });

  it('sends an anonymous visitor of /admin/cupons to /login with the encoded next path', async () => {
    stubApi(null);
    renderRoute('/admin/cupons');

    await waitFor(() => expect(locationOf()).toBe('/login?next=%2Fadmin%2Fcupons'));
  });

  it('shows "Acesso restrito" with a link to /app when a tenant opens /admin/financeiro', async () => {
    stubApi(base);
    renderRoute('/admin/financeiro');

    expect(await screen.findByRole('heading', { name: 'Acesso restrito' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ir para minha área' })).toHaveAttribute(
      'href',
      '/app',
    );
    expect(locationOf()).toBe('/admin/financeiro');
  });

  it('sends staff enrolled in TOTP but not verified to /login/2fa', async () => {
    stubApi(admin({ enrolled: true, verified: false }));
    renderRoute('/admin/cupons');

    await waitFor(() => expect(locationOf()).toBe('/login/2fa'));
  });

  it('sends staff without TOTP to /login/2fa/configurar', async () => {
    stubApi(admin({ enrolled: false, verified: false }));
    renderRoute('/admin');

    await waitFor(() => expect(locationOf()).toBe('/login/2fa/configurar'));
  });

  it('shows "Acesso restrito" when reception opens /admin/financeiro', async () => {
    stubApi(reception({ enrolled: true, verified: true }));
    renderRoute('/admin/financeiro');

    expect(await screen.findByRole('heading', { name: 'Acesso restrito' })).toBeInTheDocument();
  });

  it('redirects /admin to /admin/reservas for reception', async () => {
    stubApi(reception({ enrolled: true, verified: true }));
    renderRoute('/admin');

    await waitFor(() => expect(locationOf()).toBe('/admin/reservas'));
    expect(await screen.findByRole('heading', { name: 'Gestão de Reservas' })).toBeInTheDocument();
  });

  it('redirects /admin to the first section for a verified admin', async () => {
    stubApi(admin({ enrolled: true, verified: true }));
    renderRoute('/admin');

    await waitFor(() => expect(locationOf()).toBe('/admin/calendario'));
  });

  it('renders the placeholder page for a signed-in tenant on /app/orcamentos', async () => {
    stubApi(base);
    renderRoute('/app/orcamentos');

    expect(await screen.findByRole('heading', { name: 'Orçamentos' })).toBeInTheDocument();
    expect(screen.getByText('Em construção')).toBeInTheDocument();
  });
});

describe('app and admin shells', () => {
  it('wraps the tenant routes: the sidebar link to Compras opens the Compras area', async () => {
    stubApi(base);
    renderRoute('/app/orcamentos');
    const sidebar = await screen.findByRole('navigation', { name: 'Menu lateral' });

    await userEvent.click(within(sidebar).getByRole('link', { name: 'Compras' }));

    expect(await screen.findByRole('heading', { name: 'Compras' })).toBeInTheDocument();
    expect(locationOf()).toBe('/app/compras');
    expect(screen.getByRole('button', { name: 'Sair' })).toBeInTheDocument();
  });

  it('wraps the admin routes: the Financeiro link opens its placeholder page for a verified admin', async () => {
    stubApi(admin({ enrolled: true, verified: true }));
    renderRoute('/admin/calendario');
    const menu = await screen.findByRole('navigation', { name: 'Seções do painel' });
    expect(within(menu).getAllByRole('link')).toHaveLength(10);

    await userEvent.click(within(menu).getByRole('link', { name: 'Financeiro' }));

    expect(await screen.findByRole('heading', { name: 'Financeiro' })).toBeInTheDocument();
    expect(locationOf()).toBe('/admin/financeiro');
    expect(screen.getByText('Em construção')).toBeInTheDocument();
  });
});
