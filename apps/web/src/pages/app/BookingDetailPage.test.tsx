import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bookingAwaitingPayment,
  bookingDetail,
  cancellationPreview,
  chargeIntent,
  ID,
  quote,
  rescheduleQuote,
} from '../../test/fixtures/nucleo';
import { server } from '../../test/msw/server';
import { renderWithProviders } from '../../test/render-with-providers';
import { BookingDetailPage } from './BookingDetailPage';

// Only `Date` is faked, so timers, MSW and Testing Library keep running normally.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-20T15:00:00Z'));
  server.use(
    http.get('*/api/public/config', () =>
      HttpResponse.json({ googleEnabled: false, whatsappE164: '+5547999990000' }),
    ),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

function renderDetail() {
  return renderWithProviders(
    <Routes>
      <Route path="/app/minhas-reservas/:id" element={<BookingDetailPage />} />
    </Routes>,
    `/app/minhas-reservas/${ID.booking}`,
  );
}

const serveBooking = (booking: object) => {
  server.use(http.get('*/api/app/bookings/:id', () => HttpResponse.json(booking)));
};

/** Opens the reschedule dialog and picks 2026-10-28 at 11:30 for one hour. */
async function pickNewSlot() {
  await userEvent.click(await screen.findByRole('button', { name: 'Reagendar' }));
  await userEvent.click(await screen.findByRole('button', { name: /^28 de outubro/ }));
  await userEvent.click(await screen.findByRole('button', { name: /^11:30/ }));
  await userEvent.click(screen.getByRole('button', { name: '1h' }));
}

const money = (text: string) => text.replace(/\u00a0/g, ' ');

describe('BookingDetailPage (NUC-154..156)', () => {
  it('shows the summary, the charges and the calendar file link', async () => {
    serveBooking(bookingDetail);
    renderDetail();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Reserva BRV-7K2Q9X' }),
    ).toBeVisible();
    expect(screen.getByRole('region', { name: 'Resumo da reserva' })).toBeInTheDocument();
    expect(money(document.body.textContent ?? '')).toContain('Sinal · Pix · R$ 109,50');
    expect(screen.getByRole('link', { name: /Adicionar ao calendário/ })).toHaveAttribute(
      'href',
      `/api/app/bookings/${ID.booking}/ics`,
    );
  });

  it('hides "Reagendar" and shows "Fale com a recepção" on WhatsApp when canReschedule is false', async () => {
    serveBooking({
      ...bookingDetail,
      actions: {
        ...bookingDetail.actions,
        canReschedule: false,
        rescheduleBlockedReason: 'too_late',
      },
    });
    renderDetail();

    const link = await screen.findByRole('link', { name: 'Fale com a recepção' });
    expect(link).toHaveAttribute('href', 'https://wa.me/5547999990000');
    expect(screen.queryByRole('button', { name: 'Reagendar' })).toBeNull();
    expect(screen.getByText('O prazo para reagendar online terminou.')).toBeInTheDocument();
  });

  it('ST-2: a cheaper slot shows "Você recebe R$ 23,00 em créditos"', async () => {
    serveBooking(bookingDetail);
    server.use(
      http.post('*/api/app/bookings/:id/reschedule/quote', () =>
        HttpResponse.json({
          ...rescheduleQuote,
          settlement: {
            payNowCents: 0,
            creditCents: 2300,
            newTotalCents: 8000,
            newBalanceCents: 0,
          },
        }),
      ),
    );
    renderDetail();

    await pickNewSlot();

    expect(await screen.findByText('Você recebe R$ 23,00 em créditos')).toBeInTheDocument();
    expect(screen.queryByText(/Diferença a pagar agora/)).toBeNull();
  });

  it('ST-3: a dearer slot shows "Diferença a pagar agora: R$ 143,00" and opens the payment panel on confirm (202)', async () => {
    serveBooking(bookingDetail);
    let body: Record<string, unknown> | null = null;
    server.use(
      http.post('*/api/app/bookings/:id/reschedule/quote', () =>
        HttpResponse.json({
          ...rescheduleQuote,
          newQuote: quote,
          settlement: {
            payNowCents: 14300,
            creditCents: 0,
            newTotalCents: 36200,
            newBalanceCents: 0,
          },
        }),
      ),
      http.post('*/api/app/bookings/:id/reschedule', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          {
            rescheduleRequestId: ID.booking,
            expiresAt: '2026-10-20T15:15:00.000Z',
            charge: { ...chargeIntent, amountCents: 14300 },
          },
          { status: 202 },
        );
      }),
    );
    renderDetail();

    await pickNewSlot();
    expect(await screen.findByText('Diferença a pagar agora: R$ 143,00')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar reagendamento' }));

    const dialog = screen.getByRole('dialog', { name: 'Reagendar reserva' });
    expect(within(dialog).getByRole('radio', { name: 'Pix' })).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: /^Pagar/ }));

    expect(await within(dialog).findByRole('img', { name: 'QR Code do Pix' })).toBeInTheDocument();
    expect(body).toMatchObject({
      roomSlug: 'principal',
      date: '2026-10-28',
      startMinute: 690,
      endMinute: 750,
      method: 'pix',
    });
  });

  it('moves the booking at once and reports the credit when there is no difference to pay', async () => {
    serveBooking(bookingDetail);
    server.use(
      http.post('*/api/app/bookings/:id/reschedule', () =>
        HttpResponse.json({ ...bookingDetail, rescheduleCount: 1, creditCents: 0 }),
      ),
    );
    renderDetail();

    await pickNewSlot();
    await userEvent.click(await screen.findByRole('button', { name: 'Confirmar reagendamento' }));

    expect(await screen.findByText('Reserva reagendada.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows the API message when the reschedule is refused', async () => {
    serveBooking(bookingDetail);
    server.use(
      http.post('*/api/app/bookings/:id/reschedule/quote', () =>
        HttpResponse.json({
          allowed: false,
          reason: 'too_late',
          message: 'O prazo para reagendar terminou.',
          newQuote: null,
          settlement: null,
        }),
      ),
    );
    renderDetail();

    await pickNewSlot();

    expect(await screen.findByText('O prazo para reagendar terminou.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirmar reagendamento' })).toBeDisabled();
  });

  it('CA-1: the cancel modal shows what is retained and refunded, then cancels with an Idempotency-Key', async () => {
    serveBooking({ ...bookingDetail, depositCents: 8000 });
    let headers: Headers | null = null;
    server.use(
      http.get('*/api/app/bookings/:id/cancellation-preview', () =>
        HttpResponse.json({ ...cancellationPreview, retainedCents: 8000, refundCents: 8000 }),
      ),
      http.post('*/api/app/bookings/:id/cancel', ({ request }) => {
        headers = request.headers;
        return HttpResponse.json({ ...bookingDetail, status: 'cancelled_by_tenant' });
      }),
    );
    renderDetail();

    await userEvent.click(await screen.findByRole('button', { name: 'Cancelar reserva' }));
    expect(await screen.findByText('Fica retido: R$ 80,00 (sinal)')).toBeInTheDocument();
    expect(screen.getByText('Será devolvido: R$ 80,00')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar cancelamento' }));

    expect(await screen.findByText('Reserva cancelada.')).toBeInTheDocument();
    expect((headers as Headers | null)?.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('opens the payment panel to pay the balance', async () => {
    serveBooking(bookingDetail);
    let called = 0;
    server.use(
      http.post('*/api/app/bookings/:id/pay-balance', () => {
        called += 1;
        return HttpResponse.json(chargeIntent);
      }),
    );
    renderDetail();

    await userEvent.click(await screen.findByRole('button', { name: 'Pagar saldo' }));
    await userEvent.click(await screen.findByRole('button', { name: /^Pagar R\$\s109,50$/ }));

    expect(await screen.findByRole('img', { name: 'QR Code do Pix' })).toBeInTheDocument();
    expect(called).toBe(1);
  });

  it('links an unpaid booking to its checkout instead of offering the balance', async () => {
    serveBooking(bookingAwaitingPayment);
    renderDetail();

    expect(await screen.findByRole('link', { name: 'Ir para o pagamento' })).toHaveAttribute(
      'href',
      `/checkout/${ID.booking}`,
    );
    expect(screen.queryByRole('button', { name: 'Pagar saldo' })).toBeNull();
  });
});
