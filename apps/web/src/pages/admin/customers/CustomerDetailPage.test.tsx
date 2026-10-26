import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import {
  CUSTOMER_IDS,
  customerDetail,
  moreBookings,
} from '../../../features/admin-customers/fixtures';
import { apiError } from '../../../test/msw/handlers';
import { server } from '../../../test/msw/server';
import { renderWithProviders } from '../../../test/render-with-providers';
import { plain, stubStaffSession, type StaffRole } from '../../../test/session';
import { CustomerDetailPage } from './CustomerDetailPage';

function Probe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}

interface Calls {
  notes: unknown[];
  profile: unknown[];
  anonymize: unknown[];
  bookingCursors: (string | null)[];
}

function stubApi(): Calls {
  const calls: Calls = { notes: [], profile: [], anonymize: [], bookingCursors: [] };
  server.use(
    http.get('*/api/admin/customers/:id', () => HttpResponse.json(customerDetail)),
    http.get('*/api/admin/customers/:id/bookings', ({ request }) => {
      calls.bookingCursors.push(new URL(request.url).searchParams.get('cursor'));
      return HttpResponse.json(moreBookings);
    }),
    http.patch('*/api/admin/customers/:id/notes', async ({ request }) => {
      calls.notes.push(await request.json());
      return HttpResponse.json({ ok: true });
    }),
    http.patch('*/api/admin/customers/:id', async ({ request }) => {
      calls.profile.push(await request.json());
      return HttpResponse.json({ ok: true });
    }),
    http.post('*/api/admin/customers/:id/anonymize', async ({ request }) => {
      calls.anonymize.push(await request.json());
      return HttpResponse.json({ ok: true });
    }),
  );
  return calls;
}

async function renderPage(role: StaffRole = 'admin') {
  stubStaffSession(role);
  const calls = stubApi();
  renderWithProviders(
    <>
      <Routes>
        <Route path="/admin/clientes/:id" element={<CustomerDetailPage />} />
        <Route path="/admin/clientes" element={<p>Lista de clientes</p>} />
      </Routes>
      <Probe />
    </>,
    `/admin/clientes/${CUSTOMER_IDS.ana}`,
  );
  await screen.findByRole('heading', { level: 1, name: 'Ana Souza' });
  return calls;
}

const section = (name: string) => screen.getByRole('region', { name });
const cellsOf = (row: HTMLElement) =>
  within(row)
    .getAllByRole('cell')
    .map((c) => plain(c.textContent));
const rowWith = (scope: HTMLElement, text: string) =>
  within(scope).getByText(text).closest('tr') as HTMLElement;

describe('CustomerDetailPage sections (GES-100)', () => {
  it('shows the profile', async () => {
    await renderPage();

    const profile = section('Cadastro');
    expect(profile).toHaveTextContent('ana@example.com');
    expect(profile).toHaveTextContent('(47) 99999-0001');
    expect(profile).toHaveTextContent('***.982.247-**');
    expect(profile).toHaveTextContent('Psicóloga');
    expect(profile).toHaveTextContent('CRP 12/34567');
  });

  it('shows bookings with their pt-BR status and total', async () => {
    await renderPage();

    const bookings = section('Reservas');
    expect(cellsOf(rowWith(bookings, 'BRV-7K2Q9X'))).toEqual([
      'BRV-7K2Q9X',
      'Sala Aurora',
      '03/11/2026 14:00',
      'Confirmada',
      'R$ 219,00',
    ]);
    expect(cellsOf(rowWith(bookings, 'BRV-3M8T1A'))[3]).toBe('Concluída');
  });

  it('shows subscriptions, extra-minute lots, credits, coupons, consents and quote requests', async () => {
    await renderPage();

    expect(
      cellsOf(rowWith(section('Assinaturas'), 'Assinatura Horário Fixo (Sala Aurora)')),
    ).toEqual(['Assinatura Horário Fixo (Sala Aurora)', 'Ativa', '02/10/2026', '02/11/2026', '8h']);
    expect(cellsOf(rowWith(section('Horas extras'), 'Horas extras compradas'))).toEqual([
      'Horas extras compradas',
      '2h',
      '31/12/2026',
    ]);
    const credits = section('Créditos');
    expect(credits).toHaveTextContent('Disponível: R$ 65,00');
    expect(cellsOf(rowWith(credits, 'Diferença de reagendamento'))).toEqual([
      'Diferença de reagendamento',
      'R$ 45,00',
      'Sem validade',
    ]);
    expect(cellsOf(rowWith(credits, 'Crédito manual'))).toEqual([
      'Crédito manual',
      'R$ 20,00',
      '15/01/2027',
    ]);
    expect(cellsOf(rowWith(section('Cupons usados'), 'BEMVINDA10'))).toEqual([
      'BEMVINDA10',
      'Usado',
      'R$ 21,90',
      '01/10/2026',
    ]);
    expect(cellsOf(rowWith(section('Consentimentos'), 'Política de reservas'))).toEqual([
      'Política de reservas',
      '2026-09',
      '01/10/2026',
    ]);
    expect(cellsOf(rowWith(section('Consentimentos'), 'Termos da assinatura'))[0]).toBe(
      'Termos da assinatura',
    );
    expect(cellsOf(rowWith(section('Pedidos de orçamento'), 'Pacote de filmagem'))).toEqual([
      'Pacote de filmagem',
      'Em contato',
      '20/10/2026',
    ]);
  });

  it('loads the next bookings with the cursor and appends them', async () => {
    const calls = await renderPage();

    await userEvent.click(
      within(section('Reservas')).getByRole('button', { name: 'Carregar mais reservas' }),
    );

    expect(await within(section('Reservas')).findByText('BRV-9P4R2C')).toBeInTheDocument();
    expect(within(section('Reservas')).getByText('BRV-7K2Q9X')).toBeInTheDocument();
    expect(calls.bookingCursors).toEqual(['bookings-2']);
    expect(
      within(section('Reservas')).queryByRole('button', { name: 'Carregar mais reservas' }),
    ).not.toBeInTheDocument();
  });

  it('shows an error alert when the customer cannot be loaded', async () => {
    stubStaffSession('admin');
    server.use(
      http.get('*/api/admin/customers/:id', () =>
        apiError(404, 'NOT_FOUND', 'Cliente não encontrado.'),
      ),
    );
    renderWithProviders(
      <Routes>
        <Route path="/admin/clientes/:id" element={<CustomerDetailPage />} />
      </Routes>,
      `/admin/clientes/${CUSTOMER_IDS.ana}`,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('Cliente não encontrado.');
  });
});

describe('CustomerDetailPage roles (GES-101, GES-102)', () => {
  it('gives the admin the notes editor, "Editar cadastro" and "Excluir dados (LGPD)"', async () => {
    await renderPage('admin');

    expect(await screen.findByRole('button', { name: 'Editar cadastro' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Excluir dados (LGPD)' })).toBeInTheDocument();
    expect(screen.getByLabelText('Anotações')).toHaveValue('Prefere sala silenciosa.');
  });

  it('gives the reception the notes editor but neither "Editar cadastro" nor "Excluir dados (LGPD)"', async () => {
    await renderPage('reception');

    expect(await screen.findByLabelText('Anotações')).toHaveValue('Prefere sala silenciosa.');
    expect(screen.getByRole('button', { name: 'Salvar anotações' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Editar cadastro' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Excluir dados (LGPD)' })).not.toBeInTheDocument();
  });

  it('saves the notes', async () => {
    const calls = await renderPage('reception');
    const notes = await screen.findByLabelText('Anotações');

    await userEvent.clear(notes);
    await userEvent.type(notes, 'Chega sempre 10 min antes.');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar anotações' }));

    await waitFor(() => {
      expect(calls.notes).toEqual([{ notes: 'Chega sempre 10 min antes.' }]);
    });
    expect(await screen.findByText('Anotações salvas.')).toBeInTheDocument();
  });

  it('refuses notes over 4000 characters with the core message', async () => {
    const calls = await renderPage('reception');
    const notes = await screen.findByLabelText('Anotações');

    await userEvent.click(notes);
    await userEvent.paste('a'.repeat(4000));
    await userEvent.click(screen.getByRole('button', { name: 'Salvar anotações' }));

    expect(await screen.findByText('Use no máximo 4000 caracteres')).toBeInTheDocument();
    expect(calls.notes).toEqual([]);
  });
});

describe('CustomerDetailPage admin actions (GES-102, GES-127)', () => {
  it('edits the profile fields with the shared schema and sends the E.164 phone', async () => {
    const calls = await renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Editar cadastro' }));
    const dialog = await screen.findByRole('dialog', { name: 'Editar cadastro' });
    expect(within(dialog).getByLabelText('Telefone')).toHaveValue('(47) 99999-0001');
    await userEvent.clear(within(dialog).getByLabelText('Nome'));
    await userEvent.type(within(dialog).getByLabelText('Nome'), 'Ana Souza Lima');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salvar cadastro' }));

    await waitFor(() => {
      expect(calls.profile).toEqual([
        {
          name: 'Ana Souza Lima',
          phone: '+5547999990001',
          profession: 'Psicóloga',
          professionalRegistry: 'CRP 12/34567',
        },
      ]);
    });
  });

  it('shows the core message for an invalid name and sends nothing', async () => {
    const calls = await renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Editar cadastro' }));
    const dialog = await screen.findByRole('dialog', { name: 'Editar cadastro' });
    await userEvent.clear(within(dialog).getByLabelText('Nome'));
    await userEvent.type(within(dialog).getByLabelText('Nome'), 'A');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salvar cadastro' }));

    expect(await within(dialog).findByText('Informe seu nome completo')).toBeInTheDocument();
    expect(calls.profile).toEqual([]);
  });

  it('anonymizes only with a justification of 5 characters or more, then returns to the list', async () => {
    const calls = await renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Excluir dados (LGPD)' }));
    const dialog = await screen.findByRole('dialog', { name: 'Excluir dados do cliente' });
    const confirm = within(dialog).getByRole('button', { name: 'Excluir dados' });
    expect(confirm).toBeDisabled();

    await userEvent.type(within(dialog).getByLabelText('Justificativa'), 'abc');
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText('Justificativa'), 'de pedido do titular');
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);

    await waitFor(() => {
      expect(calls.anonymize).toEqual([{ justification: 'abcde pedido do titular' }]);
    });
    expect(await screen.findByText('Lista de clientes')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/admin/clientes');
  });

  it('lists the commitments that block the anonymization (409) and keeps the customer', async () => {
    await renderPage();
    server.use(
      http.post('*/api/admin/customers/:id/anonymize', () =>
        HttpResponse.json(
          {
            error: {
              code: 'HAS_ACTIVE_COMMITMENTS',
              message: 'O cliente tem compromissos em aberto.',
              details: {
                bookings: [{ code: 'BRV-7K2Q9X' }, { code: 'BRV-1A2B3C' }],
                subscriptions: [{ id: 's1000000-0000-4000-8000-000000000001' }],
              },
            },
          },
          { status: 409 },
        ),
      ),
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Excluir dados (LGPD)' }));
    const dialog = await screen.findByRole('dialog', { name: 'Excluir dados do cliente' });
    await userEvent.type(within(dialog).getByLabelText('Justificativa'), 'pedido do titular');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Excluir dados' }));

    const list = await within(dialog).findByRole('list', { name: 'Compromissos em aberto' });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([
      'Reserva BRV-7K2Q9X',
      'Reserva BRV-1A2B3C',
      'Assinatura s1000000-0000-4000-8000-000000000001',
    ]);
    expect(dialog).toHaveTextContent('O cliente tem compromissos em aberto.');
    expect(screen.getByTestId('location')).toHaveTextContent(`/admin/clientes/${CUSTOMER_IDS.ana}`);
  });
});
