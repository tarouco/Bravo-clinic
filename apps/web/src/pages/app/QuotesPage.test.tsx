import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { ownQuoteRequests } from '../../features/extras/fixtures';
import { apiError } from '../../test/msw/handlers';
import { server } from '../../test/msw/server';
import { renderWithProviders } from '../../test/render-with-providers';
import { QuotesPage } from './QuotesPage';

describe('QuotesPage (GES-97)', () => {
  it("lists the tenant's requests with service, status label, dates and booking code", async () => {
    server.use(http.get('*/api/app/quote-requests', () => HttpResponse.json(ownQuoteRequests)));
    renderWithProviders(<QuotesPage />, '/app/orcamentos');

    const first = (await screen.findByRole('heading', { name: 'Pacote de filmagem' })).closest(
      'li',
    ) as HTMLElement;
    expect(within(first).getByText('Novo')).toBeInTheDocument();
    expect(within(first).getByText(/Enviado em 25\/10\/2026/)).toBeInTheDocument();
    expect(within(first).getByText(/Data desejada: 20\/11\/2026/)).toBeInTheDocument();

    const second = screen.getByRole('heading', { name: 'Videomaker' }).closest('li') as HTMLElement;
    expect(within(second).getByText('Orçamento enviado')).toBeInTheDocument();
    expect(within(second).getByText(/Reserva BRV-7K2Q9X/)).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('links to the public page for a new request', async () => {
    server.use(http.get('*/api/app/quote-requests', () => HttpResponse.json(ownQuoteRequests)));
    renderWithProviders(<QuotesPage />, '/app/orcamentos');

    expect(await screen.findByRole('link', { name: 'Novo pedido' })).toHaveAttribute(
      'href',
      '/servicos-extras',
    );
  });

  it('says so when the tenant has no requests yet', async () => {
    server.use(
      http.get('*/api/app/quote-requests', () =>
        HttpResponse.json({ items: [], nextCursor: null }),
      ),
    );
    renderWithProviders(<QuotesPage />, '/app/orcamentos');

    expect(await screen.findByText('Você ainda não pediu nenhum orçamento.')).toBeInTheDocument();
  });

  it('shows an error when the list cannot be loaded', async () => {
    server.use(
      http.get('*/api/app/quote-requests', () => apiError(500, 'INTERNAL', 'Erro interno.')),
    );
    renderWithProviders(<QuotesPage />, '/app/orcamentos');

    expect(
      await screen.findByText('Não foi possível carregar seus orçamentos agora.'),
    ).toBeInTheDocument();
  });
});
