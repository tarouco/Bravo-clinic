import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { bookingList } from '../../test/fixtures/nucleo';
import { server } from '../../test/msw/server';
import { renderWithProviders } from '../../test/render-with-providers';
import { AppHomePage } from './AppHomePage';

const first = bookingList.items[0];
if (!first) throw new Error('fixture booking missing');

function renderHome() {
  return renderWithProviders(
    <Routes>
      <Route path="/app" element={<AppHomePage />} />
    </Routes>,
    '/app',
  );
}

describe('AppHomePage (NUC-191)', () => {
  it('lists only the next 3 upcoming bookings and offers "Reservar"', async () => {
    server.use(
      http.get('*/api/app/bookings', () =>
        HttpResponse.json({
          items: [1, 2, 3, 4].map((n) => ({
            ...first,
            id: `22222222-2222-4222-8222-00000000000${String(n)}`,
            code: `BRV-AAAA0${String(n)}`,
          })),
          nextCursor: null,
        }),
      ),
    );
    renderHome();

    expect(await screen.findAllByRole('link', { name: /BRV-AAAA/ })).toHaveLength(3);
    expect(screen.queryByRole('link', { name: /BRV-AAAA04/ })).toBeNull();
    expect(screen.getByRole('link', { name: 'Reservar' })).toHaveAttribute('href', '/app/reservar');
  });

  it('says so when there are no upcoming bookings', async () => {
    server.use(
      http.get('*/api/app/bookings', () => HttpResponse.json({ items: [], nextCursor: null })),
    );
    renderHome();

    expect(await screen.findByText('Você não tem reservas próximas.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Reservar' })).toBeInTheDocument();
  });
});
