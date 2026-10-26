import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ledgerPage } from '../../features/purchases/fixtures';
import { renderWithProviders } from '../../test/render-with-providers';
import { LedgerTable } from './LedgerTable';

const debitRow = () => screen.getByRole('row', { name: /BRV-7K2Q9X/ });

// REC-41: extrato lines with formula text; REC-42: "Compra" label of the first grant.
describe('LedgerTable (REC-41, REC-42)', () => {
  it('renders the Wednesday debit: label, booking code, formula text, signed minutes and balance', () => {
    renderWithProviders(<LedgerTable items={ledgerPage.items} />);

    const row = within(debitRow());
    expect(row.getByText('Reserva')).toBeInTheDocument();
    expect(row.getByText('BRV-7K2Q9X')).toBeInTheDocument();
    expect(row.getByText('60 min + 18 min de excedente = 78 min')).toBeInTheDocument();
    expect(row.getByText('−78 min')).toBeInTheDocument();
    expect(row.getByText('1.122 min')).toBeInTheDocument();
    expect(row.getByText('04/11/2026 · 19:00')).toBeInTheDocument();
  });

  it('renders the purchase grant as "Compra" with +1.200 min and no booking code', () => {
    renderWithProviders(<LedgerTable items={ledgerPage.items} />);

    const grant = within(screen.getByRole('row', { name: /Compra/ }));
    expect(grant.getByText('+1.200 min')).toBeInTheDocument();
    expect(grant.getByText('1.200 min')).toBeInTheDocument();
    expect(grant.queryByText(/BRV-/)).not.toBeInTheDocument();
  });

  it('marks entries of the extra-hours ledger', () => {
    const extra = {
      id: 'extra:1',
      at: '2026-11-10T12:00:00.000Z',
      kind: 'extra' as const,
      entryType: 'grant' as const,
      label: 'Horas extras compradas',
      minutes: 120,
      balanceAfter: 120,
    };
    renderWithProviders(<LedgerTable items={[extra]} />);

    const row = within(screen.getByRole('row', { name: /Horas extras compradas/ }));
    expect(row.getByText('+120 min')).toBeInTheDocument();
    expect(row.getByText('Horas extras')).toBeInTheDocument();
  });

  it('calls onLoadMore from "Carregar mais" when there are more pages', async () => {
    const onLoadMore = vi.fn();
    renderWithProviders(<LedgerTable items={ledgerPage.items} hasMore onLoadMore={onLoadMore} />);

    await userEvent.click(screen.getByRole('button', { name: 'Carregar mais' }));

    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('hides "Carregar mais" without more pages', () => {
    renderWithProviders(
      <LedgerTable items={ledgerPage.items} hasMore={false} onLoadMore={vi.fn()} />,
    );

    expect(screen.queryByRole('button', { name: 'Carregar mais' })).not.toBeInTheDocument();
  });

  it('disables "Carregar mais" while the next page loads', () => {
    renderWithProviders(
      <LedgerTable items={ledgerPage.items} hasMore loadingMore onLoadMore={vi.fn()} />,
    );

    expect(screen.getByRole('button', { name: 'Carregar mais' })).toBeDisabled();
  });

  it('shows the empty state', () => {
    renderWithProviders(<LedgerTable items={[]} />);

    expect(screen.getByText('Nenhum lançamento ainda.')).toBeInTheDocument();
  });
});
