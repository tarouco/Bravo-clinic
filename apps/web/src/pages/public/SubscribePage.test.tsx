import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse, type JsonBodyType } from 'msw';
import { Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  meioTurno,
  occurrenceCheckFull,
  occurrenceCheckWithConflict,
  pacote20h,
  packageOffers,
  RID,
  subscriptionActive,
  subscriptionPurchaseResult,
  subscriptionQuote,
} from '../../features/purchases/fixtures';
import { disableAnalytics, enableGa4, gtagEvents } from '../../test/analytics';
import { ID, me } from '../../test/fixtures/nucleo';
import { server } from '../../test/msw/server';
import { renderWithProviders } from '../../test/render-with-providers';
import { plain } from '../../test/session';
import { spaced } from '../../test/text';
import { SubscribePage } from './SubscribePage';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-26T15:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

function LoginProbe() {
  const { pathname, search } = useLocation();
  return <output data-testid="login">{`${pathname}${search}`}</output>;
}

const HOUR_URL = `/assinar/${RID.pacote}?baseOn=2026-11-02`;
const FIXED_URL = `/assinar/${RID.meioTurno}?roomId=${ID.principal}&baseOn=2026-11-02`;

function stubCatalog(options: { loggedIn: boolean }) {
  server.use(
    http.get('*/api/public/packages', () => HttpResponse.json(packageOffers)),
    http.get('*/api/public/packages/:categoryId/occurrences', () =>
      HttpResponse.json(occurrenceCheckFull),
    ),
    http.get('*/api/app/me', () =>
      options.loggedIn
        ? HttpResponse.json(me)
        : HttpResponse.json(
            { error: { code: 'UNAUTHENTICATED', message: 'Entre' } },
            { status: 401 },
          ),
    ),
    http.get('*/api/app/cards', () => HttpResponse.json({ items: [] })),
  );
}

/** Serves the quote and records the bodies posted to it. */
function stubQuote(quote: JsonBodyType = subscriptionQuote) {
  const bodies: Record<string, unknown>[] = [];
  server.use(
    http.post('*/api/app/subscriptions/quote', async ({ request }) => {
      bodies.push((await request.json()) as Record<string, unknown>);
      return HttpResponse.json(quote);
    }),
  );
  return bodies;
}

const purchaseOk = {
  ...subscriptionPurchaseResult,
  charge: { ...subscriptionPurchaseResult.charge, amountCents: 160000 },
};

/** Serves the purchase POST and records the body and the Idempotency-Key header. */
function stubPurchase(
  respond: () => Response | Promise<Response> = () =>
    HttpResponse.json(purchaseOk, { status: 201 }),
) {
  const calls: { body: Record<string, unknown>; key: string | null }[] = [];
  server.use(
    http.post('*/api/app/subscriptions', async ({ request }) => {
      calls.push({
        body: (await request.json()) as Record<string, unknown>,
        key: request.headers.get('Idempotency-Key'),
      });
      return respond();
    }),
  );
  return calls;
}

function renderPage(route: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/assinar/:categoryId" element={<SubscribePage />} />
      <Route path="/login" element={<LoginProbe />} />
    </Routes>,
    route,
  );
}

const acceptBoth = async () => {
  await userEvent.click(screen.getByRole('checkbox', { name: /Termos de uso/ }));
  await userEvent.click(screen.getByRole('checkbox', { name: /cobrança recorrente/ }));
};

const stepNames = () =>
  within(screen.getByRole('navigation', { name: 'Etapas da assinatura' }))
    .getAllByRole('listitem')
    .map((item) => item.textContent ?? '');

// REC-156: at most 4 steps; REC-158: summary sentence and the two checkboxes; REC-157: login redirect.
describe('SubscribePage steps and summary (REC-156, REC-158, REC-91)', () => {
  it('shows 3 steps for an hour package', async () => {
    stubCatalog({ loggedIn: true });
    stubQuote();
    renderPage(HOUR_URL);

    await screen.findByRole('heading', { name: `Assinar ${pacote20h.name}` });
    expect(stepNames()).toHaveLength(3);
    expect(stepNames()[0]).toContain('Resumo');
  });

  it('shows 4 steps for a fixed schedule, starting at "Sala e início" when nothing is chosen', async () => {
    stubCatalog({ loggedIn: true });
    renderPage(`/assinar/${RID.meioTurno}`);

    await screen.findByRole('heading', { name: `Assinar ${meioTurno.name}` });
    expect(stepNames()).toHaveLength(4);
    expect(stepNames()[0]).toContain('Sala e início');
    expect(await screen.findByRole('radio', { name: 'Sala Principal' })).toBeInTheDocument();
  });

  it('shows the renewal sentence, the period and the amounts of the quote', async () => {
    stubCatalog({ loggedIn: true });
    const bodies = stubQuote();
    renderPage(HOUR_URL);

    expect(
      await screen.findByText(
        spaced('Renova automaticamente em 02/12/2026 por R$ 1.600,00 (cobrança 2 dias antes)'),
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('02/11/2026 a 01/12/2026')).toBeInTheDocument();
    expect(screen.getByText('Pagar agora')).toBeInTheDocument();
    expect(bodies[0]).toEqual({ categoryId: RID.pacote, baseOn: '2026-11-02' });
  });

  it('shows the same summary to a visitor who is not logged in, without asking for a quote', async () => {
    stubCatalog({ loggedIn: false });
    const bodies = stubQuote();
    renderPage(HOUR_URL);

    expect(
      await screen.findByText(
        spaced('Renova automaticamente em 02/12/2026 por R$ 1.600,00 (cobrança 2 dias antes)'),
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/Cupom e créditos ficam disponíveis/)).toBeInTheDocument();
    expect(bodies).toHaveLength(0);
  });

  it('shows "22 ocorrências × R$ 280,00 = R$ 6.160,00" in the fixed-schedule summary (REC-91)', async () => {
    stubCatalog({ loggedIn: false });
    renderPage(FIXED_URL);

    expect(
      await screen.findByText(spaced('22 ocorrências × R$ 280,00 = R$ 6.160,00')),
    ).toBeInTheDocument();
    expect(screen.getByText(/Renova automaticamente em 02\/12\/2026/)).toBeInTheDocument();
  });

  it('disables "Continuar para pagamento" until both checkboxes are checked', async () => {
    stubCatalog({ loggedIn: true });
    stubQuote();
    renderPage(HOUR_URL);
    const button = await screen.findByRole('button', { name: 'Continuar para pagamento' });
    await screen.findByText(/Renova automaticamente/);

    expect(button).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', { name: /Termos de uso/ }));
    expect(button).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', { name: /cobrança recorrente/ }));
    expect(button).toBeEnabled();
  });

  it('shows the not-found page for an unknown category', async () => {
    stubCatalog({ loggedIn: true });
    renderPage('/assinar/00000000-0000-4000-8000-000000000000');

    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Continuar para pagamento' }),
    ).not.toBeInTheDocument();
  });
});

describe('SubscribePage login redirect (REC-157)', () => {
  it('sends a logged-out visitor to /login keeping the chosen options in next', async () => {
    stubCatalog({ loggedIn: false });
    renderPage(HOUR_URL);
    await screen.findByText(/Renova automaticamente/);
    await acceptBoth();

    await userEvent.click(screen.getByRole('button', { name: 'Continuar para pagamento' }));

    const shown = (await screen.findByTestId('login')).textContent ?? '';
    const next = new URLSearchParams(shown.split('?')[1]).get('next');
    expect(shown.startsWith('/login?next=')).toBe(true);
    expect(next).toBe(`/assinar/${RID.pacote}?baseOn=2026-11-02`);
  });

  it('keeps room and coupon in next for a fixed schedule', async () => {
    stubCatalog({ loggedIn: false });
    renderPage(`${FIXED_URL}&cupom=BRAVO10`);
    await screen.findByText(/Renova automaticamente/);
    await acceptBoth();

    await userEvent.click(screen.getByRole('button', { name: 'Continuar para pagamento' }));

    const shown = (await screen.findByTestId('login')).textContent ?? '';
    const next = new URLSearchParams(shown.split('?')[1]).get('next') ?? '';
    expect(next).toContain(`roomId=${ID.principal}`);
    expect(next).toContain('baseOn=2026-11-02');
    expect(next).toContain('cupom=BRAVO10');
  });
});

describe('SubscribePage coupon and credits (REC-117, REC-107)', () => {
  it('sends the upper-cased code with the quote and shows the discount', async () => {
    stubCatalog({ loggedIn: true });
    const bodies = stubQuote();
    renderPage(HOUR_URL);
    await screen.findByText(/Renova automaticamente/);

    server.use(
      http.post('*/api/app/subscriptions/quote', async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({
          ...subscriptionQuote,
          discountCents: 16000,
          payNowCents: 144000,
        });
      }),
    );
    await userEvent.type(screen.getByLabelText('Cupom de desconto'), 'bravo10');
    await userEvent.click(screen.getByRole('button', { name: 'Aplicar' }));

    expect(await screen.findByText(/Cupom BRAVO10 aplicado/)).toBeInTheDocument();
    expect(bodies.at(-1)).toMatchObject({ couponCode: 'BRAVO10' });
    expect(screen.getByText(spaced('− R$ 160,00'))).toBeInTheDocument();
    expect(screen.getByText(spaced('R$ 1.440,00'))).toBeInTheDocument();
  });

  it('shows the credits toggle with the available amount and sends useCredits', async () => {
    stubCatalog({ loggedIn: true });
    const bodies = stubQuote();
    renderPage(HOUR_URL);

    const toggle = await screen.findByRole('switch', {
      name: (name) => plain(name) === 'Usar créditos (R$ 50,00 disponíveis)',
    });
    await userEvent.click(toggle);

    await vi.waitFor(() => {
      expect(bodies.at(-1)).toMatchObject({ useCredits: true });
    });
  });

  it('shows the rejection message the quote reports under the coupon field', async () => {
    stubCatalog({ loggedIn: true });
    stubQuote({
      ...subscriptionQuote,
      couponRejection: { reason: 'expired', message: 'Cupom expirado' },
    });
    renderPage(`${HOUR_URL}&cupom=VELHO`);

    expect(await screen.findByText('Cupom expirado')).toBeInTheDocument();
  });
});

describe('SubscribePage payment (REC-14, REC-20)', () => {
  async function goToPayment(route: string) {
    renderPage(route);
    await screen.findByText(/Renova automaticamente/);
    await screen.findByRole('region', { name: 'Cupom' });
    await acceptBoth();
    await userEvent.click(screen.getByRole('button', { name: 'Continuar para pagamento' }));
    return screen.findByRole('heading', { name: /Pagamento de/ });
  }

  it('creates the subscription with the consents, the method and an Idempotency-Key, then shows the Pix code', async () => {
    stubCatalog({ loggedIn: true });
    stubQuote();
    const calls = stubPurchase();
    server.use(
      http.get('*/api/app/subscriptions/:id', () =>
        HttpResponse.json({ ...subscriptionActive, status: 'awaiting_payment' }),
      ),
    );

    const heading = await goToPayment(HOUR_URL);
    expect(plain(heading.textContent)).toBe('Pagamento de R$ 1.600,00');
    await userEvent.click(screen.getByRole('button', { name: /^Pagar R\$/ }));

    expect(await screen.findByRole('img', { name: 'QR Code do Pix' })).toBeInTheDocument();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toEqual({
      categoryId: RID.pacote,
      baseOn: '2026-11-02',
      paymentMethod: 'pix',
      acceptTerms: true,
      acceptRecurring: true,
    });
    expect(calls[0]?.key).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('shows "Assinatura ativa" once the subscription becomes active', async () => {
    stubCatalog({ loggedIn: true });
    stubQuote();
    stubPurchase();
    server.use(
      http.get('*/api/app/subscriptions/:id', () => HttpResponse.json(subscriptionActive)),
    );

    await goToPayment(HOUR_URL);
    await userEvent.click(screen.getByRole('button', { name: /^Pagar R\$/ }));

    expect(await screen.findByText('Assinatura ativa')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver minhas compras' })).toHaveAttribute(
      'href',
      '/app/compras',
    );
  });

  it('tracks subscription_purchased once when the subscription becomes active (GES-135)', async () => {
    enableGa4();
    try {
      stubCatalog({ loggedIn: true });
      stubQuote();
      stubPurchase();
      server.use(
        http.get('*/api/app/subscriptions/:id', () => HttpResponse.json(subscriptionActive)),
      );

      await goToPayment(HOUR_URL);
      expect(gtagEvents().filter((event) => event.name === 'subscription_purchased')).toHaveLength(
        0,
      );
      await userEvent.click(screen.getByRole('button', { name: /^Pagar R\$/ }));

      await screen.findByText('Assinatura ativa');
      const events = gtagEvents().filter((event) => event.name === 'subscription_purchased');
      expect(events).toHaveLength(1);
      expect(events[0]?.params).toMatchObject({
        categoryType: 'hour_package',
        valueBucket: '>1000',
      });
    } finally {
      disableAnalytics();
    }
  });

  it('confirms without a payment form when credits and coupon cover everything', async () => {
    stubCatalog({ loggedIn: true });
    stubQuote({ ...subscriptionQuote, creditAppliedCents: 160000, payNowCents: 0 });
    const calls = stubPurchase(() =>
      HttpResponse.json({ subscription: subscriptionActive, charge: null }, { status: 201 }),
    );
    server.use(
      http.get('*/api/app/subscriptions/:id', () => HttpResponse.json(subscriptionActive)),
    );
    renderPage(HOUR_URL);
    await screen.findByText(/Renova automaticamente/);
    await acceptBoth();
    await userEvent.click(screen.getByRole('button', { name: 'Continuar para pagamento' }));

    await userEvent.click(await screen.findByRole('button', { name: 'Confirmar assinatura' }));

    expect(await screen.findByText('Assinatura ativa')).toBeInTheDocument();
    expect(calls).toHaveLength(1);
  });

  it('409 CONFLICT shows the REC-12 message with a link to /app/compras', async () => {
    stubCatalog({ loggedIn: true });
    stubQuote();
    const message = 'Você já tem um pacote de horas. Use “Trocar pacote” em Compras.';
    stubPurchase(() =>
      HttpResponse.json({ error: { code: 'CONFLICT', message } }, { status: 409 }),
    );

    await goToPayment(HOUR_URL);
    await userEvent.click(screen.getByRole('button', { name: /^Pagar R\$/ }));

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ir para Compras' })).toHaveAttribute(
      'href',
      '/app/compras',
    );
    expect(screen.queryByRole('button', { name: /^Pagar R\$/ })).not.toBeInTheDocument();
  });

  it('409 OCCURRENCE_CONFLICT returns to the picker listing the taken dates', async () => {
    stubCatalog({ loggedIn: true });
    stubQuote({ ...subscriptionQuote, priceCents: 616000, payNowCents: 616000 });
    stubPurchase(() => {
      // Someone took Wednesday while the visitor was paying: the next check reports it.
      server.use(
        http.get('*/api/public/packages/:categoryId/occurrences', () =>
          HttpResponse.json(occurrenceCheckWithConflict),
        ),
      );
      return HttpResponse.json(
        {
          error: {
            code: 'OCCURRENCE_CONFLICT',
            message: 'Alguns horários não estão disponíveis.',
            details: [
              {
                path: 'date',
                message: 'Já reservado',
                date: '2026-11-04',
                reason: 'overlaps_booking',
              },
            ],
          },
        },
        { status: 409 },
      );
    });

    await goToPayment(FIXED_URL);
    await userEvent.click(screen.getByRole('button', { name: /^Pagar R\$/ }));

    expect(
      await screen.findByText('Alguns horários foram ocupados enquanto você finalizava a compra:'),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Qua 04/11/2026: Já reservado').length).toBeGreaterThan(0);
    expect(await screen.findByRole('radio', { name: 'Sala Principal' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled();
  });

  it('422 COUPON_INVALID returns to the summary with the message under the coupon field', async () => {
    stubCatalog({ loggedIn: true });
    stubQuote();
    stubPurchase(() =>
      HttpResponse.json(
        {
          error: {
            code: 'COUPON_INVALID',
            message: 'Cupom inválido',
            details: [{ path: 'couponCode', message: 'Cupom esgotado' }],
          },
        },
        { status: 422 },
      ),
    );

    await goToPayment(`${HOUR_URL}&cupom=BRAVO10`);
    await userEvent.click(screen.getByRole('button', { name: /^Pagar R\$/ }));

    expect(await screen.findByText('Cupom esgotado')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continuar para pagamento' })).toBeInTheDocument();
  });
});
