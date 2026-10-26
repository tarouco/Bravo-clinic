import type { LocalDate } from '@bravo/core';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { closedDayPreview, holiday, ID } from '../../test/fixtures/nucleo';
import { server } from '../../test/msw/server';
import { renderWithProviders } from '../../test/render-with-providers';
import { ExceptionsMonth } from './ExceptionsMonth';

const NOVEMBER = '2026-11-15' as LocalDate;

function renderMonth() {
  return renderWithProviders(
    <ExceptionsMonth date={NOVEMBER} today={'2026-10-20'} onDateChange={vi.fn()} />,
  );
}

async function holidayRow() {
  const name = await screen.findByText('Finados', { selector: 'span.font-medium' });
  return name.closest('li') as HTMLElement;
}

describe('ExceptionsMonth (NUC-52)', () => {
  it('lists a holiday with its scope badge and the alert icon when it is near', async () => {
    renderMonth();

    const row = await holidayRow();
    expect(within(row).getByText('Nacional')).toBeInTheDocument();
    expect(
      within(row).getByRole('img', { name: 'Feriado nos próximos 30 dias' }),
    ).toBeInTheDocument();
    expect(within(row).getByRole('checkbox', { name: 'Finados: Fechado' })).not.toBeChecked();
  });

  it('omits the alert icon of a holiday that is not near', async () => {
    server.use(
      http.get('*/api/admin/calendar/holidays', () =>
        HttpResponse.json({ items: [{ ...holiday, alert: false }] }),
      ),
    );
    renderMonth();

    const row = await holidayRow();
    expect(within(row).queryByRole('img')).toBeNull();
  });

  it('closes a holiday and opens the affected list on a 409', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.patch('*/api/admin/calendar/holidays/:id', async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(
          {
            error: {
              code: 'AFFECTED_BOOKINGS',
              message: 'Existem reservas afetadas.',
              details: { bookings: closedDayPreview.affectedBookings },
              requestId: 'req-test-0001',
            },
          },
          { status: 409 },
        );
      }),
    );
    renderMonth();
    const row = await holidayRow();

    await userEvent.click(within(row).getByRole('checkbox', { name: 'Finados: Fechado' }));

    const dialog = await screen.findByRole('dialog', { name: 'Reservas afetadas' });
    expect(within(dialog).getByRole('link', { name: 'BRV-7K2Q9X' })).toBeInTheDocument();
    expect(bodies).toEqual([{ isClosed: true }]);
  });

  it('shows the inserted and updated counts in a toast after importing a year', async () => {
    renderMonth();

    await userEvent.click(await screen.findByRole('button', { name: 'Importar feriados de 2026' }));

    expect(
      await screen.findByText('Importação concluída: 3 novos, 1 atualizado.'),
    ).toBeInTheDocument();
  });

  it('adds a manual holiday with its scope', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post('*/api/admin/calendar/holidays', async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(holiday, { status: 201 });
      }),
    );
    renderMonth();

    await userEvent.click(await screen.findByRole('button', { name: 'Novo feriado' }));
    const dialog = screen.getByRole('dialog', { name: 'Novo feriado' });
    await userEvent.type(within(dialog).getByLabelText('Data do feriado'), '2027-02-09');
    await userEvent.type(within(dialog).getByLabelText('Nome do feriado'), 'Carnaval');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Adicionar feriado' }));

    await waitFor(() =>
      expect(bodies).toEqual([{ date: '2027-02-09', name: 'Carnaval', scope: 'optional' }]),
    );
  });

  it('lists closed days and recurring blocks and reopens a closed day', async () => {
    const deleted = vi.fn<(id: string) => void>();
    server.use(
      http.delete('*/api/admin/calendar/closed-days/:id', ({ params }) => {
        deleted(String(params['id']));
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderMonth();

    const closed = await screen.findByRole('region', { name: 'Dias fechados' });
    expect(await within(closed).findByText('Toda a clínica')).toBeInTheDocument();
    expect(within(closed).getByText('Recesso')).toBeInTheDocument();
    const recurring = screen.getByRole('region', { name: 'Bloqueios recorrentes' });
    expect(await within(recurring).findByText('Limpeza profunda')).toBeInTheDocument();
    expect(within(recurring).getByText(/Sala Principal · Seg · 07:00–08:00/)).toBeInTheDocument();

    await userEvent.click(within(closed).getByRole('button', { name: 'Reabrir 24/12/2026' }));
    await waitFor(() => expect(deleted).toHaveBeenCalledWith(ID.closedDay));
  });
});
