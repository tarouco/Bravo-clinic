import { adminSectionMeta, type AdminSection } from '@bravo/core';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '../../features/auth/useSession';
import { renderWithProviders } from '../../test/render-with-providers';
import { ComingSoon } from '../ui/Feedback';
import { AdminShell } from './AdminShell';

const admin: Session = {
  id: 'u1',
  name: 'Carla Mendes',
  email: 'carla@example.com',
  role: 'admin',
  emailVerified: true,
  docType: 'cpf',
  mfa: { enrolled: true, verified: true },
};

const reception: Session = { ...admin, name: 'Rui Lima', role: 'reception' };

/** PRD 7.3 order, the labels the AdminShell must show for an admin. */
const ADMIN_LABELS = [
  'Calendário',
  'Gestão de Reservas',
  'Financeiro',
  'Integrações',
  'Cupons',
  'Serviços Extras',
  'Clientes',
  'Salas',
  'Usuários',
  'Log de auditoria',
];

function json(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Answers `/api/app/me` with the session and every other call with 204. */
function stubApi(session: Session) {
  const fetchMock = vi
    .fn()
    .mockImplementation((url: string) =>
      Promise.resolve(url === '/api/app/me' ? json(200, session) : json(204)),
    );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function Where() {
  const location = useLocation();
  return <p data-testid="where">{location.pathname}</p>;
}

function renderShell(route = '/admin/calendario') {
  const sections = Object.keys(adminSectionMeta) as AdminSection[];
  return renderWithProviders(
    <Routes>
      <Route path="admin" element={<AdminShell />}>
        {sections.map((section) => {
          const { label, path } = adminSectionMeta[section];
          return (
            <Route
              key={section}
              path={path.replace('/admin/', '')}
              element={<ComingSoon title={label} />}
            />
          );
        })}
      </Route>
      <Route path="*" element={<Where />} />
    </Routes>,
    route,
  );
}

const sidebarLinks = (): HTMLElement[] =>
  within(screen.getByRole('navigation', { name: 'Seções do painel' })).getAllByRole('link');

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AdminShell navigation', () => {
  it('lists the ten sections for an admin, in PRD order, linking to their paths', async () => {
    stubApi(admin);
    renderShell();
    await screen.findByText('Carla Mendes');

    const links = sidebarLinks();
    expect(links.map((link) => link.textContent)).toEqual(ADMIN_LABELS);
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/admin/calendario',
      '/admin/reservas',
      '/admin/financeiro',
      '/admin/integracoes',
      '/admin/cupons',
      '/admin/servicos-extras',
      '/admin/clientes',
      '/admin/salas',
      '/admin/usuarios',
      '/admin/auditoria',
    ]);
  });

  it('lists only Gestão de Reservas and Clientes for reception', async () => {
    stubApi(reception);
    renderShell('/admin/reservas');
    await screen.findByText('Rui Lima');

    expect(sidebarLinks().map((link) => link.textContent)).toEqual([
      'Gestão de Reservas',
      'Clientes',
    ]);
  });

  it('opens the placeholder page of a section: heading "Cupons" and "Em construção"', async () => {
    stubApi(admin);
    const user = userEvent.setup();
    renderShell();
    await screen.findByText('Carla Mendes');

    await user.click(screen.getByRole('link', { name: 'Cupons' }));

    expect(await screen.findByRole('heading', { name: 'Cupons' })).toBeInTheDocument();
    expect(screen.getByText('Em construção')).toBeInTheDocument();
  });
});

describe('AdminShell top bar', () => {
  it('shows the user name and "Administrador geral" for an admin', async () => {
    stubApi(admin);
    renderShell();

    const header = screen.getByRole('banner');
    expect(await within(header).findByText('Carla Mendes')).toBeInTheDocument();
    expect(within(header).getByText('Administrador geral')).toBeInTheDocument();
    expect(within(header).getByRole('button', { name: 'Alternar tema' })).toBeInTheDocument();
  });

  it('shows "Recepção" as the role label of reception', async () => {
    stubApi(reception);
    renderShell('/admin/reservas');

    const header = screen.getByRole('banner');
    expect(await within(header).findByText('Rui Lima')).toBeInTheDocument();
    expect(within(header).getByText('Recepção')).toBeInTheDocument();
    expect(within(header).queryByText('Administrador geral')).not.toBeInTheDocument();
  });

  it('calls logout and navigates to / when "Sair" is clicked', async () => {
    const fetchMock = stubApi(admin);
    const user = userEvent.setup();
    renderShell();

    await user.click(await screen.findByRole('button', { name: 'Sair' }));

    expect(await screen.findByTestId('where')).toHaveTextContent(/^\/$/);
    const logoutCall = fetchMock.mock.calls.find(([url]) => url === '/api/app/auth/logout') as
      [string, RequestInit] | undefined;
    expect(logoutCall?.[1].method).toBe('POST');
  });
});
