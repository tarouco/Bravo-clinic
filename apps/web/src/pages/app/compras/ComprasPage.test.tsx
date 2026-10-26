import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse, type JsonBodyType } from 'msw';
import { Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import {
  creditsSummary,
  extraHoursIneligible,
  extraHoursSummary,
  ledgerPage,
  packageOffers,
  RID,
  subscriptionActive,
  subscriptionAwaiting,
  subscriptionEnded,
  subscriptionSuspended,
} from '../../../features/purchases/fixtures';
import { server } from '../../../test/msw/server';
import { renderWithProviders } from '../../../test/render-with-providers';
import { plain } from '../../../test/session';
import { spaced } from '../../../test/text';
import { ComprasLayout, ComprasPage } from './ComprasPage';

function Probe() {
  const { pathname } = useLocation();
  return <output data-testid="path">{pathname}</output>;
}

function stubArea(
  items: JsonBodyType[],
  options: { extra?: JsonBodyType; subscription?: JsonBodyType } = {},
) {
  server.use(
    http.get('*/api/app/subscriptions', () => HttpResponse.json({ items })),
    http.get('*/api/app/extra-hours', () => HttpResponse.json(options.extra ?? extraHoursSummary)),
    http.get('*/api/public/packages', () => HttpResponse.json(packageOffers)),
    http.get('*/api/app/cards', () => HttpResponse.json({ items: [] })),
    http.get('*/api/app/credits', () => HttpResponse.json(creditsSummary)),
    ...(options.subscription
      ? [http.get('*/api/app/subscriptions/:id', () => HttpResponse.json(options.subscription))]
      : []),
  );
}

function renderArea(route = '/app/compras') {
  return renderWithProviders(
    <>
      <Routes>
        <Route path="/app/compras" element={<ComprasLayout />}>
          <Route index element={<ComprasPage />} />
          <Route path="assinaturas/:id/pagar" element={<ComprasPage />} />
          <Route path="creditos" element={<p>Página de créditos</p>} />
          <Route path="horas-extras" element={<p>Página de horas extras</p>} />
        </Route>
      </Routes>
      <Probe />
    </>,
    route,
  );
}

const cardOf = async (name: string) =>
  within(
    (await screen.findByRole('heading', { name })).closest(
      'div[class*="rounded-card"]',
    ) as HTMLElement,
  );

// REC-143: card content; REC-144: actions per status; REC-146: tabs; REC-147: empty state.
describe('ComprasPage subscription cards (REC-143, REC-144, REC-147)', () => {
  it('shows "Trocar", "Cancelar" and "Extrato" for an active subscription and no payment action', async () => {
    stubArea([subscriptionActive]);
    renderArea();

    const card = await cardOf('Pacote 20h');
    expect(card.getByText('Ativa')).toBeInTheDocument();
    expect(card.getByRole('button', { name: 'Trocar' })).toBeInTheDocument();
    expect(card.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument();
    expect(card.getByRole('button', { name: 'Extrato' })).toBeInTheDocument();
    expect(card.queryByRole('link', { name: 'Regularizar' })).not.toBeInTheDocument();
    expect(card.queryByRole('link', { name: 'Pagar' })).not.toBeInTheDocument();
  });

  it('shows only "Regularizar" for a suspended subscription, linking to its payment dialog', async () => {
    stubArea([subscriptionSuspended]);
    renderArea();

    const card = await cardOf('Pacote 20h');
    expect(card.getByText('Suspensa')).toBeInTheDocument();
    expect(card.getByRole('link', { name: 'Regularizar' })).toHaveAttribute(
      'href',
      `/app/compras/assinaturas/${RID.subSuspended}/pagar`,
    );
    expect(card.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows only "Pagar" for a subscription awaiting payment', async () => {
    stubArea([subscriptionAwaiting]);
    renderArea();

    const card = await cardOf('Meio turno');
    expect(card.getByText('Aguardando pgto')).toBeInTheDocument();
    expect(card.getByRole('link', { name: 'Pagar' })).toHaveAttribute(
      'href',
      `/app/compras/assinaturas/${RID.subAwaiting}/pagar`,
    );
    expect(card.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows no action for an ended subscription', async () => {
    stubArea([subscriptionEnded]);
    renderArea();

    const card = await cardOf('Pacote 20h');
    expect(card.getByText('Encerrada')).toBeInTheDocument();
    expect(card.queryByRole('button')).not.toBeInTheDocument();
    expect(card.queryByRole('link')).not.toBeInTheDocument();
  });

  it('reads the next charge as date, amount and card', async () => {
    stubArea([subscriptionActive]);
    renderArea();

    expect(
      await screen.findByText(spaced('30/11/2026 · R$ 1.600,00 · cartão final 4242')),
    ).toBeInTheDocument();
    expect(screen.getByText('02/11/2026')).toBeInTheDocument();
  });

  it('shows the balance meter and the extra minutes of an hour package', async () => {
    stubArea([subscriptionActive]);
    renderArea();

    expect(await screen.findByText('12h 30min de 20h')).toBeInTheDocument();
    expect(screen.getByRole('meter', { name: 'Saldo do pacote' })).toHaveAttribute(
      'aria-valuenow',
      '750',
    );
    expect(screen.getByText('Horas extras: 1h 30min')).toBeInTheDocument();
  });

  it('shows room, weekdays, window and remaining occurrences of a fixed schedule', async () => {
    stubArea([subscriptionAwaiting]);
    renderArea();

    expect(await screen.findByText('Sala Principal')).toBeInTheDocument();
    expect(await screen.findByText('Seg–Sex · 07:00–09:30')).toBeInTheDocument();
    expect(screen.getByText(/22 ocorrências restantes no período/)).toBeInTheDocument();
    expect(screen.getByText(/Pague até/)).toBeInTheDocument();
  });

  it('shows "Você ainda não tem assinaturas" with a link to /precos', async () => {
    stubArea([]);
    renderArea();

    expect(await screen.findByText('Você ainda não tem assinaturas')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver pacotes' })).toHaveAttribute('href', '/precos');
  });

  it('opens the extrato of a subscription with its formula text and closes it', async () => {
    stubArea([subscriptionActive]);
    server.use(http.get('*/api/app/subscriptions/:id/ledger', () => HttpResponse.json(ledgerPage)));
    renderArea();

    await userEvent.click(await screen.findByRole('button', { name: 'Extrato' }));

    expect(await screen.findByText('60 min + 18 min de excedente = 78 min')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Fechar extrato' }));
    expect(screen.queryByText('60 min + 18 min de excedente = 78 min')).not.toBeInTheDocument();
  });
});

describe('ComprasLayout tabs (REC-146, REC-69)', () => {
  it('lists Assinaturas, Horas extras, Créditos and Histórico for an eligible tenant', async () => {
    stubArea([subscriptionActive]);
    renderArea();

    const tabs = await screen.findAllByRole('tab');
    await screen.findByRole('tab', { name: 'Horas extras' });
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Assinaturas',
      'Horas extras',
      'Créditos',
      'Histórico',
    ]);
    expect(tabs.length).toBeGreaterThan(0);
  });

  it('hides the Horas extras tab when the tenant is not eligible', async () => {
    stubArea([subscriptionSuspended], { extra: extraHoursIneligible });
    renderArea();

    await screen.findByText('Suspensa');
    expect(screen.queryByRole('tab', { name: 'Horas extras' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Assinaturas',
      'Créditos',
      'Histórico',
    ]);
  });

  it('navigates to the route of the clicked tab', async () => {
    stubArea([subscriptionActive]);
    renderArea();

    await userEvent.click(await screen.findByRole('tab', { name: 'Créditos' }));

    expect(screen.getByTestId('path')).toHaveTextContent('/app/compras/creditos');
    expect(await screen.findByText('Página de créditos')).toBeInTheDocument();
  });
});

describe('PayDialog at /app/compras/assinaturas/:id/pagar (REC-144)', () => {
  const route = `/app/compras/assinaturas/${RID.subAwaiting}/pagar`;

  it('opens the payment dialog over the list with the pending amount', async () => {
    stubArea([subscriptionAwaiting], { subscription: subscriptionAwaiting });
    renderArea(route);

    const dialog = await screen.findByRole('dialog', { name: 'Pagar assinatura' });
    expect(await within(dialog).findByRole('button', { name: /^Pagar R\$/ })).toBeInTheDocument();
    expect(within(dialog).getAllByText(spaced('R$ 6.160,00'), { selector: 'dd' })).toHaveLength(2);
    expect(await screen.findByRole('heading', { name: 'Meio turno' })).toBeInTheDocument();
  });

  it('posts the chosen method with an Idempotency-Key and shows the Pix code', async () => {
    stubArea([subscriptionAwaiting], { subscription: subscriptionAwaiting });
    const calls: { body: unknown; key: string | null }[] = [];
    server.use(
      http.post('*/api/app/subscriptions/:id/pay', async ({ request }) => {
        calls.push({ body: await request.json(), key: request.headers.get('Idempotency-Key') });
        return HttpResponse.json({
          subscription: subscriptionAwaiting,
          charge: {
            chargeId: RID.charge,
            method: 'pix',
            status: 'pending',
            amountCents: 616000,
            expiresAt: '2026-10-20T12:30:00.000Z',
            pixQrCodeBase64: 'iVBORw0KGgo=',
            pixCopyPaste: '00020126SANDBOX',
            checkoutUrl: null,
          },
        });
      }),
    );
    renderArea(route);

    await userEvent.click(await screen.findByRole('button', { name: /^Pagar R\$/ }));

    expect(await screen.findByRole('img', { name: 'QR Code do Pix' })).toBeInTheDocument();
    expect(calls[0]?.body).toEqual({ paymentMethod: 'pix' });
    expect(calls[0]?.key).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('applies credits to the amount when the toggle is on', async () => {
    stubArea([subscriptionAwaiting], { subscription: subscriptionAwaiting });
    renderArea(route);

    const toggle = await screen.findByRole('checkbox', {
      name: (name) => plain(name).startsWith('Usar créditos'),
    });
    await userEvent.click(toggle);

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(spaced('− R$ 50,00'))).toBeInTheDocument();
    expect(within(dialog).getByText(spaced('R$ 6.110,00'))).toBeInTheDocument();
  });

  it('says there is nothing to pay for an active subscription', async () => {
    stubArea([subscriptionActive], { subscription: subscriptionActive });
    renderArea(`/app/compras/assinaturas/${RID.subActive}/pagar`);

    expect(
      await screen.findByText('Esta assinatura não tem pagamento pendente.'),
    ).toBeInTheDocument();
  });

  it('closing the dialog returns to /app/compras', async () => {
    stubArea([subscriptionAwaiting], { subscription: subscriptionAwaiting });
    renderArea(route);
    await screen.findByRole('dialog', { name: 'Pagar assinatura' });

    await userEvent.click(screen.getByRole('button', { name: 'Fechar' }));

    expect(screen.getByTestId('path')).toHaveTextContent(/^\/app\/compras$/);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
