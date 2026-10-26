import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bookingAwaitingPayment, bookingDetail, chargeIntent } from '../../test/fixtures/nucleo';
import { disableAnalytics, enableGa4, gtagEvents } from '../../test/analytics';
import { server } from '../../test/msw/server';
import { renderWithProviders } from '../../test/render-with-providers';
import { CheckoutPage } from './CheckoutPage';

const redirectTo = vi.hoisted(() => vi.fn());
vi.mock('../../lib/redirect', () => ({ redirectTo }));

const PATH = `/checkout/${bookingAwaitingPayment.id}`;

// Dates and intervals are faked (countdown, 2 s polling); setTimeout stays real for MSW.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(new Date('2026-10-20T12:10:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  redirectTo.mockReset();
});

function renderCheckout() {
  return renderWithProviders(
    <Routes>
      <Route path="/checkout/:bookingId" element={<CheckoutPage />} />
      <Route path="/app/minhas-reservas" element={<p>minhas reservas</p>} />
    </Routes>,
    PATH,
  );
}

const serveBooking = (...responses: object[]) => {
  let calls = 0;
  server.use(
    http.get('*/api/app/bookings/:id', () => {
      const body = responses[Math.min(calls, responses.length - 1)];
      calls += 1;
      return HttpResponse.json(body);
    }),
  );
};

const tick = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

describe('CheckoutPage (NUC-102, NUC-103, NUC-118)', () => {
  it('counts down to holdExpiresAt and then shows "Tempo esgotado. O horário foi liberado."', async () => {
    serveBooking(bookingAwaitingPayment);
    renderCheckout();

    expect(await screen.findByText('05:00')).toBeInTheDocument();
    expect(screen.queryByText('Tempo esgotado. O horário foi liberado.')).toBeNull();

    vi.setSystemTime(new Date('2026-10-20T12:15:00Z'));
    await tick(1000);

    expect(await screen.findByText('Tempo esgotado. O horário foi liberado.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Escolher outro horário' })).toHaveAttribute(
      'href',
      '/reservar?sala=principal',
    );
  });

  it('polls every 2 s and shows "Reserva confirmada" with the code once the booking is confirmed', async () => {
    serveBooking(bookingAwaitingPayment, bookingDetail);
    renderCheckout();
    await screen.findByText('05:00');
    expect(screen.queryByText('Reserva confirmada')).toBeNull();

    await tick(2000);

    expect(await screen.findByText('Reserva confirmada')).toBeInTheDocument();
    expect(screen.getByText('BRV-7K2Q9X', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver minhas reservas' })).toHaveAttribute(
      'href',
      '/app/minhas-reservas',
    );
  });

  it('reports the purchase once when the booking is confirmed, without the booking code', async () => {
    enableGa4();
    sessionStorage.clear();
    try {
      serveBooking(bookingDetail);
      renderCheckout();
      await screen.findByText('Reserva confirmada');

      const purchases = gtagEvents().filter((event) => event.name === 'purchase');
      expect(purchases).toHaveLength(1);
      expect(purchases[0]?.params).toMatchObject({ roomSlug: 'principal', valueBucket: '100-300' });
      expect(JSON.stringify(purchases[0])).not.toContain('BRV-7K2Q9X');
    } finally {
      disableAnalytics();
    }
  });

  it('shows "Pagamento recusado. Tente outro método." when the last charge was rejected', async () => {
    serveBooking({
      ...bookingAwaitingPayment,
      charges: [
        {
          id: chargeIntent.chargeId,
          purpose: 'booking_deposit',
          method: 'pix',
          amountCents: 10950,
          status: 'rejected',
          createdAt: '2026-10-20T12:05:00.000Z',
          approvedAt: null,
        },
      ],
    });
    renderCheckout();

    expect(await screen.findByText('Pagamento recusado. Tente outro método.')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Pix' })).toBeInTheDocument();
  });

  it('shows the Pix QR code image and a copy button after choosing Pix', async () => {
    serveBooking(bookingAwaitingPayment);
    renderCheckout();

    await userEvent.click(await screen.findByRole('button', { name: /^Pagar R\$\s109,50$/ }));

    expect(await screen.findByRole('img', { name: 'QR Code do Pix' })).toHaveAttribute(
      'src',
      'data:image/png;base64,iVBORw0KGgo=',
    );
    expect(screen.getByRole('button', { name: 'Copiar código Pix' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('00020126SANDBOX')).toBeInTheDocument();
  });

  it('links the hosted page a Pix intent carries (sandbox "Aprovar pagamento" page)', async () => {
    serveBooking(bookingAwaitingPayment);
    const hosted = `http://localhost:5173/pagamento/sandbox/${chargeIntent.chargeId}`;
    server.use(
      http.post('*/api/app/bookings/:id/pay', () =>
        HttpResponse.json({ ...chargeIntent, checkoutUrl: hosted }),
      ),
    );
    renderCheckout();

    await userEvent.click(await screen.findByRole('button', { name: /^Pagar R\$\s109,50$/ }));

    expect(await screen.findByRole('link', { name: 'Abrir página de pagamento' })).toHaveAttribute(
      'href',
      hosted,
    );
    expect(screen.getByRole('img', { name: 'QR Code do Pix' })).toBeInTheDocument();
  });

  it('sends the card flow to the provider page', async () => {
    serveBooking(bookingAwaitingPayment);
    server.use(
      http.post('*/api/app/bookings/:id/pay', () =>
        HttpResponse.json({
          ...chargeIntent,
          method: 'card',
          pixQrCodeBase64: null,
          pixCopyPaste: null,
          checkoutUrl: 'https://pay.example.com/checkout/abc',
        }),
      ),
    );
    renderCheckout();

    await userEvent.click(
      await screen.findByRole('radio', { name: 'Cartão de crédito ou débito' }),
    );
    await userEvent.click(screen.getByRole('button', { name: /^Pagar/ }));

    await screen.findByText('Abrindo a página segura de pagamento…');
    expect(redirectTo).toHaveBeenCalledWith('https://pay.example.com/checkout/abc');
  });

  it('lists the saved cards and pays with the chosen one', async () => {
    serveBooking(bookingAwaitingPayment);
    let body: Record<string, unknown> | null = null;
    server.use(
      http.post('*/api/app/bookings/:id/pay', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...chargeIntent, method: 'saved_card', status: 'approved' });
      }),
    );
    renderCheckout();

    await userEvent.click(await screen.findByRole('radio', { name: 'Visa final 4242' }));
    await userEvent.click(screen.getByRole('button', { name: /^Pagar/ }));

    expect(
      await screen.findByText('Pagamento aprovado. Confirmando sua reserva…'),
    ).toBeInTheDocument();
    expect(body).toMatchObject({ method: 'saved_card' });
    expect((body as { savedCardId?: string } | null)?.savedCardId).toBeTruthy();
  });

  it('asks staff-created bookings for the policy acceptance before paying', async () => {
    serveBooking({ ...bookingAwaitingPayment, source: 'admin' });
    let body: Record<string, unknown> | null = null;
    server.use(
      http.post('*/api/app/bookings/:id/pay', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(chargeIntent);
      }),
    );
    renderCheckout();

    const pay = await screen.findByRole('button', { name: /^Pagar/ });
    expect(pay).toBeDisabled();
    await userEvent.click(
      screen.getByRole('checkbox', { name: 'Li e aceito a política de reserva' }),
    );
    expect(pay).toBeEnabled();
    await userEvent.click(pay);

    await screen.findByRole('img', { name: 'QR Code do Pix' });
    expect(body).toMatchObject({ method: 'pix', acceptPolicy: true, policyVersion: 1 });
  });

  it('does not ask web-created bookings for the acceptance again', async () => {
    serveBooking(bookingAwaitingPayment);
    renderCheckout();

    expect(await screen.findByRole('button', { name: /^Pagar/ })).toBeEnabled();
    expect(
      screen.queryByRole('checkbox', { name: 'Li e aceito a política de reserva' }),
    ).toBeNull();
  });
});
