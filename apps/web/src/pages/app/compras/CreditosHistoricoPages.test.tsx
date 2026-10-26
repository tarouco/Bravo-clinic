import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import {
  creditsSummary205,
  purchaseHistory,
  purchaseHistoryMixed,
} from '../../../features/purchases/fixtures';
import { server } from '../../../test/msw/server';
import { renderWithProviders } from '../../../test/render-with-providers';
import { spaced } from '../../../test/text';
import { CreditosPage, HistoricoPage } from './CreditosHistoricoPages';

describe('CreditosPage (REC-114)', () => {
  it('shows the available total, the lot source label and its expiry date', async () => {
    server.use(http.get('*/api/app/credits', () => HttpResponse.json(creditsSummary205)));
    renderWithProviders(<CreditosPage />);

    expect(await screen.findByText(spaced('R$ 205,33 disponíveis'))).toBeInTheDocument();
    const lots = screen.getByRole('table', { name: 'Lotes de crédito' });
    expect(within(lots).getByText('Compensação de dia fechado')).toBeInTheDocument();
    expect(within(lots).getByText('20/04/2027')).toBeInTheDocument();
    expect(within(lots).getAllByText(spaced('R$ 205,33'))).toHaveLength(2);
  });

  it('lists the ledger entries with signed amounts', async () => {
    server.use(http.get('*/api/app/credits', () => HttpResponse.json(creditsSummary205)));
    renderWithProviders(<CreditosPage />);

    const ledger = await screen.findByRole('table', { name: 'Extrato de créditos' });
    expect(within(ledger).getByText(spaced('+R$ 205,33'))).toBeInTheDocument();
    expect(within(ledger).getByText('20/10/2026 · 09:00')).toBeInTheDocument();
  });

  it('shows the empty states without credits', async () => {
    server.use(
      http.get('*/api/app/credits', () =>
        HttpResponse.json({ availableCents: 0, lots: [], ledger: [] }),
      ),
    );
    renderWithProviders(<CreditosPage />);

    expect(await screen.findByText(spaced('R$ 0,00 disponíveis'))).toBeInTheDocument();
    expect(screen.getByText('Você não tem créditos no momento.')).toBeInTheDocument();
    expect(screen.getByText('Nenhum lançamento ainda.')).toBeInTheDocument();
  });

  it('shows an error when the credits fail to load', async () => {
    server.use(
      http.get('*/api/app/credits', () =>
        HttpResponse.json({ error: { code: 'INTERNAL', message: 'Erro' } }, { status: 500 }),
      ),
    );
    renderWithProviders(<CreditosPage />);

    expect(
      await screen.findByText('Não foi possível carregar seus créditos agora.'),
    ).toBeInTheDocument();
  });
});

describe('HistoricoPage (REC-145)', () => {
  it('shows description, method, amount and status of a Pix renewal', async () => {
    server.use(
      http.get('*/api/app/purchases/history', () => HttpResponse.json(purchaseHistoryMixed)),
    );
    renderWithProviders(<HistoricoPage />);

    const row = within(
      (await screen.findByText('Pacote 20h mensal · Renovação')).closest('tr') as HTMLElement,
    );
    expect(row.getByText('Pix')).toBeInTheDocument();
    expect(row.getByText(spaced('R$ 1.600,00'))).toBeInTheDocument();
    expect(row.getByText('Aprovado')).toBeInTheDocument();
  });

  it('shows the refunded amount on a partially refunded row', async () => {
    server.use(
      http.get('*/api/app/purchases/history', () => HttpResponse.json(purchaseHistoryMixed)),
    );
    renderWithProviders(<HistoricoPage />);

    const row = within(
      (await screen.findByText('Reserva BRV-7K2Q9X')).closest('tr') as HTMLElement,
    );
    expect(row.getByText('Cartão')).toBeInTheDocument();
    expect(row.getByText('Reembolsado parcialmente')).toBeInTheDocument();
    expect(row.getByText(spaced('Reembolsado: R$ 40,00'))).toBeInTheDocument();
  });

  it('loads the next page with "Carregar mais"', async () => {
    const cursors: (string | null)[] = [];
    server.use(
      http.get('*/api/app/purchases/history', ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor');
        cursors.push(cursor);
        return HttpResponse.json(
          cursor ? purchaseHistoryMixed : { ...purchaseHistory, nextCursor: 'cursor-2' },
        );
      }),
    );
    renderWithProviders(<HistoricoPage />);

    await userEvent.click(await screen.findByRole('button', { name: 'Carregar mais' }));

    expect(await screen.findByText('Pacote 20h mensal · Renovação')).toBeInTheDocument();
    expect(cursors).toEqual([null, 'cursor-2']);
    expect(screen.queryByRole('button', { name: 'Carregar mais' })).not.toBeInTheDocument();
  });

  it('shows the empty state', async () => {
    server.use(
      http.get('*/api/app/purchases/history', () =>
        HttpResponse.json({ items: [], nextCursor: null }),
      ),
    );
    renderWithProviders(<HistoricoPage />);

    expect(await screen.findByText('Você ainda não fez compras.')).toBeInTheDocument();
  });
});
