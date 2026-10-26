import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BookingFlowPage } from '../features/booking/BookingFlowPage';
import { quoteWithRevenue, revenueOverridesSufficient } from '../features/purchases/fixtures';
import { bookingAwaitingPayment, me } from '../test/fixtures/nucleo';
import { server } from '../test/msw/server';
import { renderWithProviders } from '../test/render-with-providers';
import { spaced } from '../test/text';
import { registerRevenueSlots } from './receita';
import { resetSlots, slotComponents } from './slots';

const RESUMO = '/reservar?sala=principal&data=2026-10-27&inicio=1050&fim=1200&etapa=resumo';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-20T15:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  resetSlots();
});

describe('registerRevenueSlots (AD-031)', () => {
  it('fills the checkout slots once, however many times it runs', () => {
    registerRevenueSlots();
    registerRevenueSlots();

    expect(slotComponents('checkout.summary.discount')).toHaveLength(1);
    expect(slotComponents('checkout.summary.credits')).toHaveLength(1);
  });
});

describe('checkout slots wired into the Resumo step (REC-117, REC-24, REC-28)', () => {
  function stubQuote(overrides = revenueOverridesSufficient) {
    const quoteBodies: Record<string, unknown>[] = [];
    const bookingBodies: Record<string, unknown>[] = [];
    server.use(
      http.get('*/api/app/me', () => HttpResponse.json(me)),
      http.post('*/api/public/bookings/quote', async ({ request }) => {
        quoteBodies.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(quoteWithRevenue(overrides));
      }),
      http.post('*/api/app/bookings', async ({ request }) => {
        bookingBodies.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(bookingAwaitingPayment, { status: 201 });
      }),
    );
    return { quoteBodies, bookingBodies };
  }

  function renderResumo() {
    registerRevenueSlots();
    renderWithProviders(
      <Routes>
        <Route path="/reservar" element={<BookingFlowPage />} />
        <Route path="/checkout/:bookingId" element={<p>página de checkout</p>} />
      </Routes>,
      RESUMO,
    );
  }

  it('re-quotes with the typed coupon and sends it when the booking is created', async () => {
    const { quoteBodies, bookingBodies } = stubQuote();
    renderResumo();
    await screen.findByRole('region', { name: 'Resumo da reserva' });

    await userEvent.type(await screen.findByLabelText('Cupom de desconto'), 'bravo10');
    await userEvent.click(screen.getByRole('button', { name: 'Aplicar' }));

    await waitFor(() => expect(quoteBodies.at(-1)).toMatchObject({ couponCode: 'BRAVO10' }));
    await userEvent.click(
      await screen.findByRole('checkbox', { name: 'Li e aceito a política de reserva' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Continuar para pagamento' }));

    await screen.findByText('página de checkout');
    expect(bookingBodies[0]).toMatchObject({ couponCode: 'BRAVO10' });
  });

  it('re-quotes with useCredits when the credits toggle is checked', async () => {
    const { quoteBodies } = stubQuote();
    renderResumo();

    await userEvent.click(
      await screen.findByRole('checkbox', {
        name: spaced('Usar créditos (R$ 50,00 disponíveis)'),
      }),
    );

    await waitFor(() => expect(quoteBodies.at(-1)).toMatchObject({ useCredits: true }));
  });

  it('adds none of the receita fields to the quote request by default', async () => {
    const { quoteBodies } = stubQuote();
    renderResumo();
    await screen.findByLabelText('Cupom de desconto');

    expect(quoteBodies[0]).not.toHaveProperty('couponCode');
    expect(quoteBodies[0]).not.toHaveProperty('useCredits');
    expect(quoteBodies[0]).not.toHaveProperty('payWith');
  });
});
