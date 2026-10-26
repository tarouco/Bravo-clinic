import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerSlot, resetSlots } from '../../extensions/slots';
import { disableAnalytics, enableGa4, gtagEvents } from '../../test/analytics';
import { server } from '../../test/msw/server';
import { apiError } from '../../test/msw/handlers';
import { bookingAwaitingPayment, catalog, me, quote } from '../../test/fixtures/nucleo';
import { renderWithProviders } from '../../test/render-with-providers';
import { BookingFlowPage } from './BookingFlowPage';

const RESUMO = '/reservar?sala=principal&data=2026-10-27&inicio=1050&fim=1200&etapa=resumo';

// Only `Date` is faked, so timers, MSW and Testing Library keep running normally.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-20T15:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  resetSlots();
});

function Where() {
  const { pathname, search } = useLocation();
  return <output data-testid="where">{`${pathname}${search}`}</output>;
}

function renderResumo(route = RESUMO) {
  return renderWithProviders(
    <>
      <Routes>
        <Route path="/reservar" element={<BookingFlowPage />} />
        <Route path="/login" element={<p>página de login</p>} />
        <Route path="/app/perfil" element={<p>página de perfil</p>} />
        <Route path="/checkout/:bookingId" element={<p>página de checkout</p>} />
      </Routes>
      <Where />
    </>,
    route,
  );
}

const asTenant = () => {
  server.use(http.get('*/api/app/me', () => HttpResponse.json(me)));
};
const asAnonymous = () => {
  server.use(
    http.get('*/api/app/me', () => apiError(401, 'UNAUTHENTICATED', 'Faça login para continuar.')),
  );
};

const where = () => screen.getByTestId('where').textContent ?? '';
const continueButton = () => screen.getByRole('button', { name: 'Continuar para pagamento' });
const acceptPolicy = () =>
  userEvent.click(screen.getByRole('checkbox', { name: 'Li e aceito a política de reserva' }));

async function waitForSummary() {
  await screen.findByRole('region', { name: 'Resumo da reserva' });
  await screen.findByRole('checkbox', { name: 'Li e aceito a política de reserva' });
}

describe('SummaryStep (NUC-100, NUC-101)', () => {
  it('renders the PR-3 calculation memory and keeps the button disabled until the policy is accepted', async () => {
    asTenant();
    renderResumo();
    await waitForSummary();

    const text = (document.body.textContent ?? '').replace(/\u00a0/g, ' ');
    expect(text).toContain('17:30–19:00 · 2 horas ou mais · 1h30 × R$ 80,00 = R$ 120,00');
    expect(text).toContain('19:00–20:00 · 2 horas ou mais — noite · 1h × R$ 99,00 = R$ 99,00');
    expect(text).toContain('R$ 219,00');
    expect(
      screen.getByRole('checkbox', { name: 'Li e aceito a política de reserva' }),
    ).not.toBeChecked();
    expect(continueButton()).toBeDisabled();

    await acceptPolicy();

    expect(continueButton()).toBeEnabled();
  });

  it('sends an anonymous visitor to login with next pointing back to the same Resumo URL', async () => {
    asAnonymous();
    renderResumo();
    await waitForSummary();

    await acceptPolicy();
    await userEvent.click(continueButton());

    expect(await screen.findByText('página de login')).toBeInTheDocument();
    expect(where()).toBe(`/login?next=${encodeURIComponent(RESUMO)}`);
  });

  it('sends a tenant with an incomplete profile to /app/perfil?completar=1&next=...', async () => {
    asTenant();
    server.use(
      http.post('*/api/app/bookings', () =>
        apiError(422, 'PROFILE_INCOMPLETE', 'Complete seu cadastro com CPF ou CNPJ para reservar.'),
      ),
    );
    renderResumo();
    await waitForSummary();

    await acceptPolicy();
    await userEvent.click(continueButton());

    expect(await screen.findByText('página de perfil')).toBeInTheDocument();
    expect(where()).toBe(`/app/perfil?completar=1&next=${encodeURIComponent(RESUMO)}`);
  });

  it('creates the booking with acceptance, policy version, expected total and an Idempotency-Key, then opens the checkout', async () => {
    asTenant();
    let headers: Headers | null = null;
    let body: Record<string, unknown> | null = null;
    server.use(
      http.post('*/api/app/bookings', async ({ request }) => {
        headers = request.headers;
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(bookingAwaitingPayment, { status: 201 });
      }),
    );
    renderResumo();
    await waitForSummary();

    await acceptPolicy();
    await userEvent.click(continueButton());

    expect(await screen.findByText('página de checkout')).toBeInTheDocument();
    expect(where()).toBe(`/checkout/${bookingAwaitingPayment.id}`);
    expect(body).toMatchObject({
      roomSlug: 'principal',
      date: '2026-10-27',
      startMinute: 1050,
      endMinute: 1200,
      acceptPolicy: true,
      policyVersion: 1,
      expectedTotalCents: 21900,
    });
    expect((headers as Headers | null)?.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('shows "Este horário acabou de ser reservado." and returns to Horário on 409 SLOT_TAKEN', async () => {
    asTenant();
    server.use(
      http.post('*/api/app/bookings', () =>
        apiError(409, 'SLOT_TAKEN', 'Este horário acabou de ser reservado.'),
      ),
    );
    renderResumo();
    await waitForSummary();

    await acceptPolicy();
    await userEvent.click(continueButton());

    expect(await screen.findByText('Este horário acabou de ser reservado.')).toBeInTheDocument();
    expect(new URLSearchParams(where().split('?')[1]).get('etapa')).toBe('horario');
    const stepper = screen.getByRole('navigation', { name: 'Etapas da reserva' });
    expect(within(stepper).getByText('Horário').closest('li')).toHaveAttribute(
      'aria-current',
      'step',
    );
    expect(await screen.findByRole('list', { name: 'Horários de início' })).toBeInTheDocument();
  });

  it('re-renders the new total and unchecks the acceptance on 409 PRICE_CHANGED', async () => {
    asTenant();
    let current = quote;
    server.use(
      http.post('*/api/public/bookings/quote', () => HttpResponse.json(current)),
      http.post('*/api/app/bookings', () => {
        current = {
          ...quote,
          netCents: 23900,
          grossCents: 23900,
          payment: {
            ...quote.payment,
            depositCents: 11950,
            balanceCents: 11950,
            payNowCents: 11950,
          },
        };
        return apiError(409, 'PRICE_CHANGED', 'O valor mudou. Confira o novo resumo.');
      }),
    );
    renderResumo();
    await waitForSummary();
    expect((document.body.textContent ?? '').replace(/\u00a0/g, ' ')).toContain('R$ 219,00');

    await acceptPolicy();
    await userEvent.click(continueButton());

    expect(await screen.findByText('O valor mudou. Confira o novo resumo.')).toBeInTheDocument();
    await waitFor(() => {
      expect((document.body.textContent ?? '').replace(/\u00a0/g, ' ')).toContain('R$ 239,00');
    });
    expect(
      screen.getByRole('checkbox', { name: 'Li e aceito a política de reserva' }),
    ).not.toBeChecked();
    expect(continueButton()).toBeDisabled();
  });

  it('unchecks the acceptance and asks again on 409 POLICY_CHANGED', async () => {
    asTenant();
    server.use(
      http.post('*/api/app/bookings', () =>
        apiError(409, 'POLICY_CHANGED', 'A política foi atualizada. Revise e aceite novamente.'),
      ),
    );
    renderResumo();
    await waitForSummary();

    await acceptPolicy();
    await userEvent.click(continueButton());

    expect(
      await screen.findByText('A política foi atualizada. Revise e aceite novamente.'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', { name: 'Li e aceito a política de reserva' }),
    ).not.toBeChecked();
  });

  it('shows the banner and disables the button while prices are not reviewed', async () => {
    asTenant();
    server.use(
      http.get('*/api/public/catalog', () =>
        HttpResponse.json({ ...catalog, pricesReviewed: false }),
      ),
    );
    renderResumo();
    await waitForSummary();

    expect(
      await screen.findByText('Reservas online abrem em breve. Fale com a recepção pelo WhatsApp.'),
    ).toBeInTheDocument();
    await acceptPolicy();
    expect(continueButton()).toBeDisabled();
  });

  it('renders the components registered in the checkout.summary.extras slot with the quote', async () => {
    asTenant();
    registerSlot('checkout.summary.extras', ({ draft }: { draft: { netCents: number } }) => (
      <p>extras do slot: {draft.netCents}</p>
    ));
    renderResumo();
    await waitForSummary();

    expect(screen.getByText('extras do slot: 21900')).toBeInTheDocument();
  });

  it('tracks begin_checkout once, with the room slug and the value bucket, when the booking is created', async () => {
    enableGa4();
    try {
      asTenant();
      renderResumo();
      await waitForSummary();

      await acceptPolicy();
      await userEvent.click(continueButton());

      await screen.findByText('página de checkout');
      const events = gtagEvents().filter((event) => event.name === 'begin_checkout');
      expect(events).toHaveLength(1);
      // The fixture booking totals R$ 219,00.
      expect(events[0]?.params).toMatchObject({ roomSlug: 'principal', valueBucket: '100-300' });
      expect(events[0]?.params).not.toHaveProperty('booking_code');
    } finally {
      disableAnalytics();
    }
  });
});
