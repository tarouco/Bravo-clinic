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

  it.each([
    '/admin/integracoes',
    '/admin/servicos-extras',
    '/admin/salas',
    '/admin/salas/nova',
    '/admin/usuarios',
    '/admin/auditoria',
  ])('shows "Acesso restrito" when reception opens %s (GES-119)', async (path) => {
    stubApi(reception({ enrolled: true, verified: true }));
    renderRoute(path);

    expect(await screen.findByRole('heading', { name: 'Acesso restrito' })).toBeInTheDocument();
    expect(locationOf()).toBe(path);
  });

  it.each(['/admin/financeiro', '/admin/integracoes', '/admin/reservas/politicas'])(
    'renders the 403 page for reception on %s and lists only its two sections (GES-119)',
    async (path) => {
      stubApi(reception({ enrolled: true, verified: true }));
      renderRoute(path);

      expect(await screen.findByRole('heading', { name: 'Acesso restrito' })).toBeInTheDocument();
      const menu = screen.getByRole('navigation', { name: 'Seções do painel' });
      expect(
        within(menu)
          .getAllByRole('link')
          .map((link) => link.textContent),
      ).toEqual(['Gestão de Reservas', 'Clientes']);
      expect(locationOf()).toBe(path);
    },
  );

  it('lets reception open the customer list and a customer profile (GES-119)', async () => {
    stubApi(reception({ enrolled: true, verified: true }));
    renderRoute('/admin/clientes');

    expect(await screen.findByRole('heading', { name: 'Clientes' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Acesso restrito' })).not.toBeInTheDocument();
  });

  it('lets reception reach the customer profile route (GES-119)', async () => {
    stubApi(reception({ enrolled: true, verified: true }));
    renderRoute('/admin/clientes/c1000000-0000-4000-8000-000000000001');

    expect(await screen.findByRole('link', { name: 'Voltar para clientes' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Acesso restrito' })).not.toBeInTheDocument();
  });

  it('redirects /admin to the first section for a verified admin', async () => {
    stubApi(admin({ enrolled: true, verified: true }));
    renderRoute('/admin');

    await waitFor(() => expect(locationOf()).toBe('/admin/calendario'));
  });

  it('renders the quote requests page for a signed-in tenant on /app/orcamentos (GES-97)', async () => {
    stubApi(base);
    renderRoute('/app/orcamentos');

    expect(await screen.findByRole('heading', { name: 'Orçamentos' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Novo pedido' })).toHaveAttribute(
      'href',
      '/servicos-extras',
    );
    expect(screen.queryByText('Em construção')).not.toBeInTheDocument();
  });

  it('renders the extra services page for a visitor on /servicos-extras (GES-87)', async () => {
    stubApi(null);
    renderRoute('/servicos-extras');

    expect(await screen.findByRole('heading', { name: 'Serviços extras' })).toBeInTheDocument();
    expect(screen.queryByText('Em construção')).not.toBeInTheDocument();
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

  it('wraps the admin routes: the Usuários link opens its page for a verified admin', async () => {
    stubApi(admin({ enrolled: true, verified: true }));
    renderRoute('/admin/calendario');
    const menu = await screen.findByRole('navigation', { name: 'Seções do painel' });
    expect(within(menu).getAllByRole('link')).toHaveLength(10);

    await userEvent.click(within(menu).getByRole('link', { name: 'Usuários' }));

    expect(await screen.findByRole('heading', { name: 'Usuários' })).toBeInTheDocument();
    expect(locationOf()).toBe('/admin/usuarios');
  });
});
