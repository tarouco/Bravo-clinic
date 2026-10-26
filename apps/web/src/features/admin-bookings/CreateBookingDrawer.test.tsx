import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { customerCreated, ID, staffBookingCreated } from '../../test/fixtures/nucleo';
import { server } from '../../test/msw/server';
import { renderWithProviders } from '../../test/render-with-providers';
import { plain, stubStaffSession, type StaffRole } from '../../test/session';
import { CreateBookingDrawer, type CreateRequest } from './CreateBookingDrawer';

// Free on 2026-10-27 in the CL-4 admin availability fixture: 12:00-13:00 (bookings at 09-11, 14-16).
const FREE_SLOT: CreateRequest = {
  kind: 'booking',
  roomId: ID.principal,
  date: '2026-10-27',
  startMinute: 720,
  endMinute: 780,
};

function renderDrawer(request: CreateRequest = FREE_SLOT, role: StaffRole = 'reception') {
  stubStaffSession(role);
  return renderWithProviders(<CreateBookingDrawer request={request} onClose={vi.fn()} />);
}

function captureCreate(response: typeof staffBookingCreated = staffBookingCreated) {
  const bodies: unknown[] = [];
  server.use(
    http.post('*/api/admin/bookings', async ({ request }) => {
      bodies.push(await request.json());
      return HttpResponse.json(response, { status: 201 });
    }),
  );
  return bodies;
}

async function pickCustomer() {
  await userEvent.type(screen.getByLabelText('Buscar cliente'), 'ca');
  await userEvent.click(await screen.findByRole('button', { name: /Camila Souza/ }));
}

describe('CreateBookingDrawer customer (NUC-170)', () => {
  it('searches only from 2 characters and lists the customers found', async () => {
    const terms: (string | null)[] = [];
    server.use(
      http.get('*/api/admin/customers/search', ({ request }) => {
        terms.push(new URL(request.url).searchParams.get('q'));
        return HttpResponse.json({
          items: [
            {
              id: ID.user,
              name: 'Camila Souza',
              email: 'camila@example.com',
              docMasked: '***.982.247-**',
              phone: null,
            },
          ],
        });
      }),
    );
    renderDrawer();
    const search = screen.getByLabelText('Buscar cliente');

    await userEvent.type(search, 'c');
    expect(terms).toEqual([]);
    await userEvent.type(search, 'a');

    const list = await screen.findByRole('list', { name: 'Clientes encontrados' });
    expect(within(list).getByText(/Camila Souza/)).toBeInTheDocument();
    expect(list).toHaveTextContent('camila@example.com · ***.982.247-**');
    expect(terms).toEqual(['ca']);
  });

  it('registers a new customer inline and selects the result', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post('*/api/admin/customers', async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(customerCreated, { status: 201 });
      }),
    );
    renderDrawer();

    await userEvent.click(screen.getByRole('button', { name: 'Novo cliente' }));
    await userEvent.type(screen.getByLabelText('Nome completo'), 'Camila Souza');
    await userEvent.type(screen.getByLabelText('E-mail do cliente'), 'camila@example.com');
    await userEvent.type(screen.getByLabelText('Telefone'), '47999990001');
    await userEvent.type(screen.getByLabelText('CPF ou CNPJ'), '52998224725');
    await userEvent.click(screen.getByRole('button', { name: 'Cadastrar cliente' }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({
      name: 'Camila Souza',
      email: 'camila@example.com',
      document: '529.982.247-25',
    });
    expect(await screen.findByText('Camila Souza', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Trocar cliente' })).toBeInTheDocument();
  });
});

describe('CreateBookingDrawer booking (NUC-170)', () => {
  it('quotes a free interval and creates the booking, then shows the copyable payment link', async () => {
    const bodies = captureCreate();
    renderDrawer();
    await pickCustomer();

    const summary = await screen.findByRole('region', { name: 'Resumo da reserva' });
    expect(plain(summary.textContent)).toContain('R$ 219,00');
    await userEvent.click(screen.getByRole('button', { name: 'Criar reserva' }));

    await waitFor(() =>
      expect(bodies).toEqual([
        {
          userId: ID.user,
          roomId: ID.principal,
          date: '2026-10-27',
          startMinute: 720,
          endMinute: 780,
          kind: 'booking',
        },
      ]),
    );
    expect(await screen.findByLabelText('Link de pagamento')).toHaveValue(
      staffBookingCreated.paymentLink,
    );
    expect(screen.getByRole('button', { name: 'Copiar link' })).toBeInTheDocument();
  });

  it('rejects an interval the admin availability marks as occupied', async () => {
    renderDrawer({ ...FREE_SLOT, startMinute: 600, endMinute: 660 });

    expect(
      await screen.findByText('Horário indisponível: ocupado, em limpeza ou bloqueado.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Criar reserva' })).toBeDisabled();
  });

  it('defaults a pre-reservation to 24 h and sends the edited expiry', async () => {
    const bodies = captureCreate();
    renderDrawer({ ...FREE_SLOT, kind: 'pre_reservation' });
    await pickCustomer();
    const expiry = screen.getByLabelText('Validade da pré-reserva (horas)');
    await waitFor(() => expect(expiry).toHaveValue(24));

    await userEvent.clear(expiry);
    await userEvent.type(expiry, '48');
    await userEvent.click(await screen.findByRole('button', { name: 'Criar pré-reserva' }));

    await waitFor(() =>
      expect(bodies).toEqual([
        {
          userId: ID.user,
          roomId: ID.principal,
          date: '2026-10-27',
          startMinute: 720,
          endMinute: 780,
          kind: 'pre_reservation',
          expiresInHours: 48,
        },
      ]),
    );
  });
});

describe('CreateBookingDrawer manual confirmation (NUC-163, NUC-170)', () => {
  it('never offers "Confirmar sem pagamento" to reception', () => {
    renderDrawer(FREE_SLOT, 'reception');

    expect(screen.queryByRole('checkbox', { name: 'Confirmar sem pagamento' })).toBeNull();
  });

  it('requires a justification from an admin who confirms without payment', async () => {
    const bodies = captureCreate();
    renderDrawer(FREE_SLOT, 'admin');
    await pickCustomer();

    await userEvent.click(await screen.findByRole('checkbox', { name: 'Confirmar sem pagamento' }));
    await userEvent.click(screen.getByRole('button', { name: 'Criar reserva' }));
    expect(
      await screen.findByText('A justificativa precisa ter pelo menos 5 caracteres'),
    ).toBeInTheDocument();
    expect(bodies).toHaveLength(0);

    await userEvent.type(screen.getByLabelText('Justificativa'), 'Pago em dinheiro');
    await userEvent.click(screen.getByRole('button', { name: 'Criar reserva' }));

    await waitFor(() =>
      expect(bodies).toEqual([
        expect.objectContaining({
          confirmManually: true,
          justification: 'Pago em dinheiro',
        }),
      ]),
    );
  });
});
