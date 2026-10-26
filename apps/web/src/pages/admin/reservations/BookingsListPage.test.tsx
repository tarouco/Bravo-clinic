import { adminBookingListSchema } from '@bravo/core';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adminBookingList } from '../../../test/fixtures/nucleo';
import { parseFixture } from '../../../test/fixtures/parse';
import { server } from '../../../test/msw/server';
import { renderWithProviders } from '../../../test/render-with-providers';
import { plain } from '../../../test/session';
import { BookingsListPage } from './BookingsListPage';

const first = adminBookingList.items[0];
if (!first) throw new Error('fixture booking missing');
const second = {
  ...first,
  id: '22222222-2222-4222-8222-444444444444',
  code: 'BRV-9M4T2B',
  customerName: 'Bruno Lima',
  customerEmail: 'bruno@example.com',
  startsAt: '2026-10-28T13:00:00.000Z',
  endsAt: '2026-10-28T15:00:00.000Z',
};

function Where() {
  const location = useLocation();
  return <p data-testid="where">{location.search}</p>;
}

function renderList(route = '/admin/reservas/lista') {
  return renderWithProviders(
    <>
      <BookingsListPage />
      <Where />
    </>,
    route,
  );
}

describe('BookingsListPage table (NUC-179)', () => {
  it('shows code, customer, room, start, status, total and paid of each booking', async () => {
    renderList();

    const row = (await screen.findByText('BRV-7K2Q9X')).closest('tr') as HTMLElement;
    expect(within(row).getByText('Camila Souza')).toBeInTheDocument();
    expect(within(row).getByText('camila@example.com')).toBeInTheDocument();
    expect(within(row).getByText('Sala Principal')).toBeInTheDocument();
    expect(within(row).getByText('27/10/2026 · 17:30–20:00')).toBeInTheDocument();
    expect(within(row).getByText('Confirmada')).toBeInTheDocument();
    expect(plain(row.textContent)).toContain('R$ 219,00');
    expect(plain(row.textContent)).toContain('R$ 109,50');
  });

  it('sorts by start, newest first', async () => {
    server.use(
      http.get('*/api/admin/bookings', () =>
        HttpResponse.json(
          parseFixture(
            adminBookingListSchema,
            { items: [first, second], nextCursor: null },
            'twoBookings',
          ),
        ),
      ),
    );
    renderList();

    await screen.findByText('BRV-9M4T2B');
    const codes = screen
      .getAllByRole('row')
      .slice(1)
      .map((row) => within(row).getAllByRole('cell')[0]?.textContent);
    expect(codes).toEqual(['BRV-9M4T2B', 'BRV-7K2Q9X']);
  });
});

describe('BookingsListPage search and filters (NUC-179)', () => {
  it('keeps the search in ?q= and refetches with it', async () => {
    const terms: (string | null)[] = [];
    server.use(
      http.get('*/api/admin/bookings', ({ request }) => {
        terms.push(new URL(request.url).searchParams.get('q'));
        return HttpResponse.json(adminBookingList);
      }),
    );
    renderList();
    await screen.findByText('BRV-7K2Q9X');

    await userEvent.type(screen.getByLabelText('Buscar'), 'BRV-');

    expect(screen.getByTestId('where')).toHaveTextContent('?q=BRV-');
    await waitFor(() => expect(terms.at(-1)).toBe('BRV-'));
  });

  it('keeps the status filter in the URL', async () => {
    renderList();
    await screen.findByText('BRV-7K2Q9X');

    await userEvent.selectOptions(screen.getByLabelText('Status'), 'Confirmada');

    expect(screen.getByTestId('where')).toHaveTextContent('?status=confirmed');
  });
});

describe('BookingsListPage pagination and export (NUC-179)', () => {
  it('appends the next cursor page on "Carregar mais"', async () => {
    const cursors: (string | null)[] = [];
    server.use(
      http.get('*/api/admin/bookings', ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor');
        cursors.push(cursor);
        return HttpResponse.json(
          cursor
            ? { items: [second], nextCursor: null }
            : { items: [first], nextCursor: 'cursor-2' },
        );
      }),
    );
    renderList();
    await screen.findByText('BRV-7K2Q9X');
    expect(screen.queryByText('BRV-9M4T2B')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Carregar mais' }));

    expect(await screen.findByText('BRV-9M4T2B')).toBeInTheDocument();
    expect(screen.getByText('BRV-7K2Q9X')).toBeInTheDocument();
    expect(cursors).toEqual([null, 'cursor-2']);
    expect(screen.queryByRole('button', { name: 'Carregar mais' })).toBeNull();
  });

  describe('"Exportar CSV"', () => {
    beforeEach(() => {
      URL.createObjectURL = vi.fn(() => 'blob:csv-1');
      URL.revokeObjectURL = vi.fn();
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    });
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('requests export.csv with the current filters', async () => {
      const urls: URL[] = [];
      server.use(
        http.get('*/api/admin/bookings/export.csv', ({ request }) => {
          urls.push(new URL(request.url));
          return new HttpResponse('Código;Cliente\r\n', {
            headers: { 'Content-Type': 'text/csv; charset=utf-8' },
          });
        }),
      );
      renderList('/admin/reservas/lista?q=BRV-&status=confirmed');
      await screen.findByText('BRV-7K2Q9X');

      await userEvent.click(screen.getByRole('button', { name: 'Exportar CSV' }));

      await waitFor(() => expect(urls).toHaveLength(1));
      expect(urls[0]?.searchParams.get('q')).toBe('BRV-');
      expect(urls[0]?.searchParams.get('status')).toBe('confirmed');
    });

    it('shows the API refusal when the export is too large', async () => {
      server.use(
        http.get('*/api/admin/bookings/export.csv', () =>
          HttpResponse.json(
            {
              error: {
                code: 'VALIDATION_FAILED',
                message: 'Refine os filtros (máximo de 5.000 linhas).',
                requestId: 'req-test-0001',
              },
            },
            { status: 422 },
          ),
        ),
      );
      renderList();
      await screen.findByText('BRV-7K2Q9X');

      await userEvent.click(screen.getByRole('button', { name: 'Exportar CSV' }));

      expect(
        await screen.findByText('Refine os filtros (máximo de 5.000 linhas).'),
      ).toBeInTheDocument();
    });
  });
});
