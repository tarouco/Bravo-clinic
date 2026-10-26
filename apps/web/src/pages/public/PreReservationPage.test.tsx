import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { ID, me, TOKEN } from '../../test/fixtures/nucleo';
import { apiError } from '../../test/msw/handlers';
import { server } from '../../test/msw/server';
import { renderWithProviders } from '../../test/render-with-providers';
import { PreReservationPage } from './PreReservationPage';

function Where() {
  const { pathname, search } = useLocation();
  return <output data-testid="where">{`${pathname}${search}`}</output>;
}

function renderPage(token = TOKEN) {
  return renderWithProviders(
    <>
      <Routes>
        <Route path="/pre-reserva/:token" element={<PreReservationPage />} />
        <Route path="/login" element={<p>página de login</p>} />
        <Route path="/checkout/:bookingId" element={<p>página de checkout</p>} />
      </Routes>
      <Where />
    </>,
    `/pre-reserva/${token}`,
  );
}

const signedIn = () => {
  server.use(http.get('*/api/app/me', () => HttpResponse.json(me)));
};

describe('PreReservationPage (NUC-171)', () => {
  it('sends an anonymous visitor to login with next pointing back to the link', async () => {
    server.use(
      http.get('*/api/app/me', () =>
        apiError(401, 'UNAUTHENTICATED', 'Faça login para continuar.'),
      ),
    );
    renderPage();

    expect(await screen.findByText('página de login')).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent(
      `/login?next=${encodeURIComponent(`/pre-reserva/${TOKEN}`)}`,
    );
  });

  it('tells a user who is not the owner that the link belongs to another account', async () => {
    signedIn();
    server.use(
      http.get('*/api/app/bookings/:id', () =>
        apiError(404, 'NOT_FOUND', 'Reserva não encontrada.'),
      ),
    );
    renderPage();

    expect(await screen.findByText('Este link pertence a outra conta.')).toBeInTheDocument();
  });

  it('opens the checkout of the booking for its owner', async () => {
    signedIn();
    renderPage();

    expect(await screen.findByText('página de checkout')).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent(`/checkout/${ID.booking}`);
  });

  it('explains an unknown or expired link', async () => {
    signedIn();
    renderPage('token-desconhecido');

    expect(
      await screen.findByText(/Este link de pré-reserva não existe ou já expirou/),
    ).toBeInTheDocument();
  });
});
