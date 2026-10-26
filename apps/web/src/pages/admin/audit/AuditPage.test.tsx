import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse, type JsonBodyType } from 'msw';
import { useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { buildAuditPage } from '../../../features/admin-audit/fixtures';
import { buildStaffUsers, USER_IDS } from '../../../features/admin-users/fixtures';
import { apiError } from '../../../test/msw/handlers';
import { server } from '../../../test/msw/server';
import { renderWithProviders } from '../../../test/render-with-providers';
import { plain } from '../../../test/session';
import { AuditPage } from './AuditPage';

function Probe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

function stubApi(respond: (url: URL) => object = () => buildAuditPage()) {
  const requests: URL[] = [];
  server.use(
    http.get('*/api/admin/users', () => HttpResponse.json(buildStaffUsers())),
    http.get('*/api/admin/audit', ({ request }) => {
      const url = new URL(request.url);
      requests.push(url);
      return HttpResponse.json(respond(url) as JsonBodyType);
    }),
  );
  return requests;
}

function renderPage(route = '/admin/auditoria') {
  renderWithProviders(
    <>
      <AuditPage />
      <Probe />
    </>,
    route,
  );
}

const params = (url: URL | undefined) => Object.fromEntries(url?.searchParams ?? []);
const rowOf = (action: string) => screen.getByText(action).closest('tr') as HTMLElement;

describe('AuditPage list (GES-115)', () => {
  it('lists date, user, origin label, action and entity, newest first', async () => {
    const requests = stubApi();
    renderPage();
    await screen.findByText('mcp.booking_cancel');

    expect(params(requests[0])).toEqual({});
    expect(
      within(rowOf('mcp.booking_cancel'))
        .getAllByRole('cell')
        .map((c) => plain(c.textContent)),
    ).toEqual([
      '26/10/2026 12:00',
      'Carla Mendes',
      'MCP',
      'mcp.booking_cancel',
      'booking b1000000-0000-4000-8000-000000000001',
      expect.stringContaining('Detalhes'),
    ]);
    const web = within(rowOf('room.update')).getAllByRole('cell');
    expect(web[2]?.textContent).toBe('Web');
    const job = within(rowOf('job.recurring_expenses')).getAllByRole('cell');
    expect(job.slice(1, 3).map((c) => c.textContent)).toEqual(['—', 'Job']);
    expect(job[4]?.textContent).toBe('expense');
  });

  it('shows the empty state when nothing matches', async () => {
    stubApi(() => ({ items: [], nextCursor: null }));
    renderPage();

    expect(
      await screen.findByText('Nenhum registro para os filtros escolhidos.'),
    ).toBeInTheDocument();
  });

  it('shows an error alert with retry when the log cannot be loaded', async () => {
    let attempts = 0;
    server.use(
      http.get('*/api/admin/users', () => HttpResponse.json(buildStaffUsers())),
      http.get('*/api/admin/audit', () => {
        attempts += 1;
        // The first attempt and its automatic retry fail; the manual retry succeeds.
        return attempts <= 2
          ? apiError(500, 'INTERNAL', 'Falha ao carregar a auditoria.')
          : HttpResponse.json(buildAuditPage());
      }),
    );
    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent('Falha ao carregar a auditoria.');
    await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));

    expect(await screen.findByText('mcp.booking_cancel')).toBeInTheDocument();
  });

  it('loads the next page with the cursor', async () => {
    const requests = stubApi((url) =>
      url.searchParams.get('cursor') === 'audit-2'
        ? {
            items: [{ ...buildAuditPage().items[1], id: 0, action: 'room.create' }],
            nextCursor: null,
          }
        : buildAuditPage('audit-2'),
    );
    renderPage();
    await screen.findByText('mcp.booking_cancel');

    await userEvent.click(screen.getByRole('button', { name: 'Carregar mais' }));

    expect(await screen.findByText('room.create')).toBeInTheDocument();
    expect(requests.map((url) => url.searchParams.get('cursor'))).toEqual([null, 'audit-2']);
    expect(screen.queryByRole('button', { name: 'Carregar mais' })).not.toBeInTheDocument();
  });
});

describe('AuditPage filters (GES-115)', () => {
  it('writes the chosen filters to the URL and reloads with them', async () => {
    const requests = stubApi();
    renderPage();
    await screen.findByText('mcp.booking_cancel');

    await userEvent.selectOptions(screen.getByLabelText('Usuário'), 'Rui Lima');
    await userEvent.selectOptions(screen.getByLabelText('Origem'), 'MCP');
    await userEvent.type(screen.getByLabelText('Ação começa com'), 'mcp.');
    await userEvent.type(screen.getByLabelText('Tipo de entidade'), 'booking');
    await userEvent.type(screen.getByLabelText('ID da entidade'), 'b1000000');
    await userEvent.type(screen.getByLabelText('De'), '2026-10-01');
    await userEvent.type(screen.getByLabelText('Até'), '2026-10-26');
    await userEvent.click(screen.getByRole('button', { name: 'Filtrar' }));

    const expected = {
      actorId: USER_IDS.rui,
      origin: 'mcp',
      actionPrefix: 'mcp.',
      entityType: 'booking',
      entityId: 'b1000000',
      from: '2026-10-01',
      to: '2026-10-26',
    };
    await waitFor(() => {
      expect(params(requests.at(-1))).toEqual(expected);
    });
    const location = new URL(screen.getByTestId('location').textContent ?? '', 'http://localhost');
    expect(Object.fromEntries(location.searchParams)).toEqual(expected);
  });

  it('starts from the filters in the URL, shown in the form', async () => {
    const requests = stubApi();
    renderPage('/admin/auditoria?origin=job&actionPrefix=job.&from=2026-10-01');

    await screen.findByText('mcp.booking_cancel');

    expect(params(requests[0])).toEqual({
      origin: 'job',
      actionPrefix: 'job.',
      from: '2026-10-01',
    });
    expect(screen.getByLabelText('Origem')).toHaveValue('job');
    expect(screen.getByLabelText('Ação começa com')).toHaveValue('job.');
    expect(screen.getByLabelText('De')).toHaveValue('2026-10-01');
  });

  it('clears the filters from the form and the URL', async () => {
    const requests = stubApi();
    renderPage('/admin/auditoria?origin=job');
    await screen.findByText('mcp.booking_cancel');

    await userEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }));

    await waitFor(() => {
      expect(params(requests.at(-1))).toEqual({});
    });
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/admin\/auditoria$/);
    expect(screen.getByLabelText('Origem')).toHaveValue('');
  });
});

describe('AuditPage detail drawer (GES-116)', () => {
  it('shows date, user, origin label, action, entity, justification and the before/after JSON', async () => {
    stubApi();
    renderPage();
    await screen.findByText('mcp.booking_cancel');

    await userEvent.click(
      within(rowOf('mcp.booking_cancel')).getByRole('button', {
        name: 'Detalhes de mcp.booking_cancel',
      }),
    );
    const drawer = await screen.findByRole('dialog', { name: 'Registro de auditoria' });

    expect(drawer).toHaveTextContent('26/10/2026 12:00');
    expect(drawer).toHaveTextContent('Carla Mendes (Administrador)');
    expect(drawer).toHaveTextContent('MCP');
    expect(drawer).toHaveTextContent('mcp.booking_cancel');
    expect(drawer).toHaveTextContent('booking b1000000-0000-4000-8000-000000000001');
    expect(drawer).toHaveTextContent('Cliente pediu o cancelamento por telefone');
    expect(within(drawer).getByLabelText('Antes').textContent).toBe(
      JSON.stringify({ status: 'confirmed' }, null, 2),
    );
    expect(within(drawer).getByLabelText('Depois').textContent).toBe(
      JSON.stringify({ status: 'cancelled_by_clinic' }, null, 2),
    );
  });

  it('shows a dash for a missing justification, user and state', async () => {
    stubApi();
    renderPage();
    await screen.findByText('job.recurring_expenses');

    await userEvent.click(
      within(rowOf('job.recurring_expenses')).getByRole('button', {
        name: 'Detalhes de job.recurring_expenses',
      }),
    );
    const drawer = await screen.findByRole('dialog', { name: 'Registro de auditoria' });

    expect(within(drawer).getByText('Justificativa').nextElementSibling).toHaveTextContent('—');
    expect(within(drawer).getByText('Usuário').nextElementSibling).toHaveTextContent('—');
    expect(within(drawer).getByLabelText('Antes')).toHaveTextContent('—');
    expect(within(drawer).getByLabelText('Depois')).toHaveTextContent('—');
  });
});
