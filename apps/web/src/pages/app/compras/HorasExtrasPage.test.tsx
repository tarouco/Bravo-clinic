import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse, type JsonBodyType } from 'msw';
import { Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import {
  creditsSummary,
  extraHoursIneligible,
  extraHoursPackage20h,
  RID,
} from '../../../features/purchases/fixtures';
import { server } from '../../../test/msw/server';
import { renderWithProviders } from '../../../test/render-with-providers';
import { plain } from '../../../test/session';
import { spaced } from '../../../test/text';
import { HorasExtrasPage } from './HorasExtrasPage';

function Probe() {
  const { pathname } = useLocation();
  return <output data-testid="path">{pathname}</output>;
}

function stubExtra(summary: JsonBodyType = extraHoursPackage20h) {
  server.use(
    http.get('*/api/app/extra-hours', () => HttpResponse.json(summary)),
    http.get('*/api/app/credits', () =>
      HttpResponse.json({ ...creditsSummary, availableCents: 0, lots: [] }),
    ),
    http.get('*/api/app/cards', () => HttpResponse.json({ items: [] })),
  );
}

function renderPage() {
  return renderWithProviders(
    <>
      <Routes>
        <Route path="/app/compras/horas-extras" element={<HorasExtrasPage />} />
        <Route path="/app/compras" element={<p>Lista de compras</p>} />
      </Routes>
      <Probe />
    </>,
    '/app/compras/horas-extras',
  );
}

const stepUp = () => screen.findByRole('button', { name: 'Aumentar uma hora' });

// REC-63: unit price and total; REC-62: lots with remaining minutes and expiry; REC-69: only subscribers.
describe('HorasExtrasPage (REC-62, REC-63, REC-69)', () => {
  it('shows "5 × R$ 80,00 = R$ 400,00" after raising the stepper to 5 hours', async () => {
    stubExtra();
    renderPage();

    const up = await stepUp();
    for (let i = 0; i < 4; i += 1) await userEvent.click(up);

    expect(screen.getByText('5 horas')).toBeInTheDocument();
    expect(screen.getByText(spaced('5 × R$ 80,00 = R$ 400,00'))).toBeInTheDocument();
  });

  it('starts at the minimum and cannot go below 1 hour', async () => {
    stubExtra();
    renderPage();

    expect(await screen.findByText('1 hora')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Diminuir uma hora' })).toBeDisabled();
    expect(screen.getByText(spaced('1 × R$ 80,00 = R$ 80,00'))).toBeInTheDocument();
  });

  it('cannot go above the maximum of 20 hours', async () => {
    stubExtra();
    renderPage();
    const up = await stepUp();

    for (let i = 0; i < 25; i += 1) {
      if ((up as HTMLButtonElement).disabled) break;
      await userEvent.click(up);
    }

    expect(screen.getByText('20 horas')).toBeInTheDocument();
    expect(up).toBeDisabled();
    expect(screen.getByText(spaced('20 × R$ 80,00 = R$ 1.600,00'))).toBeInTheDocument();
  });

  it('lists the lots with remaining minutes and expiry date', async () => {
    stubExtra();
    renderPage();

    expect(await screen.findByText('300 min · vence em 08/02/2027')).toBeInTheDocument();
    expect(screen.getByText('Horas extras compradas')).toBeInTheDocument();
  });

  it('says so when there are no lots', async () => {
    stubExtra({ ...extraHoursPackage20h, lots: [], totalRemainingMinutes: 0 });
    renderPage();

    expect(await screen.findByText('Você não tem horas extras no momento.')).toBeInTheDocument();
  });

  it('sends a tenant without an active hour package back to /app/compras', async () => {
    stubExtra(extraHoursIneligible);
    renderPage();

    expect(await screen.findByText('Lista de compras')).toBeInTheDocument();
    expect(screen.getByTestId('path')).toHaveTextContent('/app/compras');
  });

  it('buys the chosen hours with the method and an Idempotency-Key, then shows the Pix code', async () => {
    stubExtra();
    const calls: { body: unknown; key: string | null }[] = [];
    server.use(
      http.post('*/api/app/extra-hours', async ({ request }) => {
        calls.push({ body: await request.json(), key: request.headers.get('Idempotency-Key') });
        return HttpResponse.json(
          {
            purchase: {
              id: RID.purchase,
              hours: 2,
              unitPriceCents: 8000,
              totalCents: 16000,
              status: 'awaiting_payment',
            },
            charge: {
              chargeId: RID.chargeExtra,
              method: 'pix',
              status: 'pending',
              amountCents: 16000,
              expiresAt: '2026-10-20T12:30:00.000Z',
              pixQrCodeBase64: 'iVBORw0KGgo=',
              pixCopyPaste: '00020126SANDBOX',
              checkoutUrl: null,
            },
          },
          { status: 201 },
        );
      }),
    );
    renderPage();
    await userEvent.click(await stepUp());

    await userEvent.click(await screen.findByRole('button', { name: /^Pagar R\$/ }));

    expect(await screen.findByRole('img', { name: 'QR Code do Pix' })).toBeInTheDocument();
    expect(calls[0]?.body).toEqual({ hours: 2, paymentMethod: 'pix' });
    expect(calls[0]?.key).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('confirms the purchase when a new lot shows up', async () => {
    let lots = extraHoursPackage20h.lots;
    server.use(
      http.get('*/api/app/extra-hours', () => HttpResponse.json({ ...extraHoursPackage20h, lots })),
      http.get('*/api/app/credits', () =>
        HttpResponse.json({ ...creditsSummary, availableCents: 0, lots: [] }),
      ),
      http.get('*/api/app/cards', () => HttpResponse.json({ items: [] })),
      http.post('*/api/app/extra-hours', () => {
        lots = [
          ...lots,
          {
            id: 'ffffffff-ffff-4fff-8fff-999999999999',
            source: 'purchase' as const,
            minutesGranted: 60,
            minutesRemaining: 60,
            expiresAt: '2027-03-08T15:00:00.000Z',
          },
        ];
        return HttpResponse.json(
          {
            purchase: {
              id: RID.purchase,
              hours: 1,
              unitPriceCents: 8000,
              totalCents: 8000,
              status: 'awaiting_payment',
            },
            charge: {
              chargeId: RID.chargeExtra,
              method: 'pix',
              status: 'pending',
              amountCents: 8000,
              expiresAt: '2026-10-20T12:30:00.000Z',
              pixQrCodeBase64: 'iVBORw0KGgo=',
              pixCopyPaste: '00020126SANDBOX',
              checkoutUrl: null,
            },
          },
          { status: 201 },
        );
      }),
    );
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: /^Pagar R\$/ }));

    expect(
      await screen.findByText('Horas extras compradas', { selector: 'p' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/1 hora foi somada/)).toBeInTheDocument();
  });

  it('offers credits and lowers the amount to pay', async () => {
    server.use(
      http.get('*/api/app/extra-hours', () => HttpResponse.json(extraHoursPackage20h)),
      http.get('*/api/app/credits', () => HttpResponse.json(creditsSummary)),
      http.get('*/api/app/cards', () => HttpResponse.json({ items: [] })),
    );
    renderPage();
    await userEvent.click(await stepUp());

    await userEvent.click(
      await screen.findByRole('checkbox', {
        name: (name) => plain(name).startsWith('Usar créditos'),
      }),
    );

    expect(screen.getByText(spaced('Pagar agora: R$ 110,00'))).toBeInTheDocument();
  });
});
