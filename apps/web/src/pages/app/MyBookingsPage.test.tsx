import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { bookingList } from '../../test/fixtures/nucleo';
import { server } from '../../test/msw/server';
import { renderWithProviders } from '../../test/render-with-providers';
import { MyBookingsPage } from './MyBookingsPage';

function renderPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/app/minhas-reservas" element={<MyBookingsPage />} />
    </Routes>,
    '/app/minhas-reservas',
  );
}

const first = bookingList.items[0];
if (!first) throw new Error('fixture booking missing');
const another = (n: number, extra: Record<string, unknown> = {}) => ({
  ...first,
  id: `22222222-2222-4222-8222-00000000000${String(n)}`,
  code: `BRV-AAAA0${String(n)}`,
  ...extra,
});

describe('MyBookingsPage (NUC-189)', () => {
  it('fetches the tab parameter of each tab when it is opened', async () => {
    const tabs: (string | null)[] = [];
    server.use(
      http.get('*/api/app/bookings', ({ request }) => {
        tabs.push(new URL(request.url).searchParams.get('tab'));
        return HttpResponse.json({ items: [], nextCursor: null });
      }),
    );
    renderPage();
    await screen.findByText('Você não tem reservas próximas.');

    await userEvent.click(screen.getByRole('tab', { name: 'Passadas' }));
    await screen.findByText('Você ainda não tem reservas passadas.');
    await userEvent.click(screen.getByRole('tab', { name: 'Canceladas' }));
    await screen.findByText('Você não tem reservas canceladas.');

    expect(tabs).toEqual(['upcoming', 'past', 'cancelled']);
  });

  it('shows code, room, date and time, status and the payment status of each row', async () => {
    renderPage();

    const row = await screen.findByRole('link', { name: /BRV-7K2Q9X/ });
    expect(row).toHaveAttribute('href', `/app/minhas-reservas/${first.id}`);
    expect(within(row).getByText('Sala Principal')).toBeInTheDocument();
    expect(within(row).getByText('27/10/2026 · 17:30–20:00')).toBeInTheDocument();
    expect(within(row).getByText('Confirmada')).toBeInTheDocument();
    expect(within(row).getByText('Sinal pago · saldo pendente')).toBeInTheDocument();
  });

  it('renders two rows with the same group id under one header', async () => {
    const group = { id: 'plano-1', label: 'Plano mensal de outubro' };
    server.use(
      http.get('*/api/app/bookings', () =>
        HttpResponse.json({
          items: [another(1, { group }), another(2, { group }), another(3)],
          nextCursor: null,
        }),
      ),
    );
    renderPage();

    const header = await screen.findByRole('heading', { name: 'Plano mensal de outubro' });
    expect(screen.getAllByRole('heading', { name: 'Plano mensal de outubro' })).toHaveLength(1);
    const section = header.closest('section') as HTMLElement;
    expect(within(section).getAllByRole('link')).toHaveLength(2);
    expect(screen.getAllByRole('link', { name: /BRV-AAAA/ })).toHaveLength(3);
  });

  it('loads the next page on demand', async () => {
    server.use(
      http.get('*/api/app/bookings', ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor');
        return HttpResponse.json(
          cursor
            ? { items: [another(2)], nextCursor: null }
            : { items: [another(1)], nextCursor: 'c2' },
        );
      }),
    );
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Carregar mais' }));

    expect(await screen.findByRole('link', { name: /BRV-AAAA02/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Carregar mais' })).toBeNull();
  });
});
