import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import {
  buildSummary,
  expenseCategories,
  expenses,
  receipts,
} from '../../../features/admin-finance/fixtures';
import { server } from '../../../test/msw/server';
import { renderWithProviders } from '../../../test/render-with-providers';
import { FinancePage } from './FinancePage';

function Probe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

function stubApi() {
  const hits: string[] = [];
  server.use(
    http.get('*/api/admin/finance/summary', () => {
      hits.push('summary');
      return HttpResponse.json(buildSummary());
    }),
    http.get('*/api/admin/finance/expense-categories', () => HttpResponse.json(expenseCategories)),
    http.get('*/api/admin/finance/expenses', () => {
      hits.push('expenses');
      return HttpResponse.json(expenses);
    }),
    http.get('*/api/admin/finance/receipts', () => {
      hits.push('receipts');
      return HttpResponse.json(receipts);
    }),
  );
  return hits;
}

function renderPage(route = '/admin/financeiro') {
  renderWithProviders(
    <>
      <FinancePage />
      <Probe />
    </>,
    route,
  );
}

describe('FinancePage tabs', () => {
  it('opens on Visão geral and fetches only the summary', async () => {
    const hits = stubApi();
    renderPage();

    expect(screen.getByRole('heading', { level: 1, name: 'Financeiro' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Visão geral', selected: true })).toBeInTheDocument();
    await screen.findByRole('heading', { name: 'Evolução' });
    expect(hits).toEqual(['summary']);
  });

  it('switches to Despesas and Recebimentos manuais, keeping the tab in the URL', async () => {
    const hits = stubApi();
    renderPage();
    await screen.findByRole('heading', { name: 'Evolução' });

    await userEvent.click(screen.getByRole('tab', { name: 'Despesas' }));
    expect(await screen.findByText('Conta de luz de setembro')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/admin/financeiro?tab=despesas');

    await userEvent.click(screen.getByRole('tab', { name: 'Recebimentos manuais' }));
    expect(await screen.findByText('Locação no balcão')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('tab=recebimentos');
    expect(hits).toContain('receipts');
  });

  it('opens straight on the tab named by the URL and returns to the overview without the param', async () => {
    stubApi();
    renderPage('/admin/financeiro?tab=despesas&regime=accrual');

    expect(await screen.findByText('Conta de luz de setembro')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Despesas', selected: true })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Visão geral' }));

    const location = screen.getByTestId('location');
    expect(location).toHaveTextContent('regime=accrual');
    expect(location).not.toHaveTextContent('tab=');
    expect(
      await within(await screen.findByRole('tabpanel', { name: 'Visão geral' })).findByRole(
        'link',
        {
          name: 'Exportar DRE (.xlsx)',
        },
      ),
    ).toHaveAttribute('href', expect.stringContaining('regime=accrual'));
  });
});
