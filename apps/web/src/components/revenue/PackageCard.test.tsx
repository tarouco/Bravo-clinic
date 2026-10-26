import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { meioTurno, pacote20h, RID } from '../../features/purchases/fixtures';
import { renderWithProviders } from '../../test/render-with-providers';
import { spaced } from '../../test/text';
import { BalanceMeter } from './BalanceMeter';
import { PackageCard } from './PackageCard';

// REC-155: offer card on /precos; REC-143: balance meter on /app/compras.
describe('PackageCard (REC-155)', () => {
  it('renders the Pacote 20h offer: price, hourly value, hours and period', () => {
    renderWithProviders(<PackageCard offer={pacote20h} />);

    expect(screen.getByRole('heading', { name: 'Pacote 20h' })).toBeInTheDocument();
    expect(screen.getByText(spaced('R$ 1.600,00'))).toBeInTheDocument();
    expect(screen.getByText(spaced('R$ 80,00/h'))).toBeInTheDocument();
    expect(screen.getByText('20 horas · mensal')).toBeInTheDocument();
  });

  it('links "Assinar" to /assinar/<categoryId>', () => {
    renderWithProviders(<PackageCard offer={pacote20h} />);

    expect(screen.getByRole('link', { name: 'Assinar' })).toHaveAttribute(
      'href',
      `/assinar/${RID.pacote}`,
    );
  });

  it('renders the Meio turno offer: weekdays, window, occurrences and period price range', () => {
    renderWithProviders(<PackageCard offer={meioTurno} />);

    expect(screen.getByRole('heading', { name: 'Meio turno' })).toBeInTheDocument();
    expect(screen.getByText('Seg–Sex · 07:00–09:30')).toBeInTheDocument();
    expect(
      screen.getByText(spaced('20–22 ocorrências · R$ 5.600,00 – R$ 6.160,00')),
    ).toBeInTheDocument();
    expect(screen.getByText(spaced('R$ 280,00 por ocorrência'))).toBeInTheDocument();
    expect(screen.getByText(spaced('R$ 112,00/h'))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Assinar' })).toHaveAttribute(
      'href',
      `/assinar/${RID.meioTurno}`,
    );
  });

  it('shows a single count when the period always has the same occurrences', () => {
    const fixed = {
      ...meioTurno,
      estimate: { minCount: 22, maxCount: 22, minCents: 616000, maxCents: 616000 },
    };
    renderWithProviders(<PackageCard offer={fixed} />);

    expect(screen.getByText(spaced('22 ocorrências · R$ 6.160,00'))).toBeInTheDocument();
  });

  it('labels bimonthly and quarterly periods', () => {
    renderWithProviders(
      <PackageCard offer={{ ...pacote20h, period: 'quarterly', periodDays: 90 }} />,
    );

    expect(screen.getByText('20 horas · trimestral')).toBeInTheDocument();
  });
});

describe('BalanceMeter (REC-143)', () => {
  it('shows "12h 30min de 20h" and exposes the meter values', () => {
    renderWithProviders(<BalanceMeter packageMinutes={750} includedMinutes={1200} />);

    expect(screen.getByText('12h 30min de 20h')).toBeInTheDocument();
    const meter = screen.getByRole('meter');
    expect(meter).toHaveAttribute('aria-valuenow', '750');
    expect(meter).toHaveAttribute('aria-valuemin', '0');
    expect(meter).toHaveAttribute('aria-valuemax', '1200');
  });

  it('shows the extra minutes line only when there are extra minutes', () => {
    const { rerender } = renderWithProviders(
      <BalanceMeter packageMinutes={750} includedMinutes={1200} extraMinutes={90} />,
    );
    expect(screen.getByText('Horas extras: 1h 30min')).toBeInTheDocument();

    rerender(<BalanceMeter packageMinutes={750} includedMinutes={1200} extraMinutes={0} />);
    expect(screen.queryByText(/Horas extras/)).not.toBeInTheDocument();
  });

  it('keeps the meter within its bounds for an empty or overfull balance', () => {
    const { rerender } = renderWithProviders(
      <BalanceMeter packageMinutes={0} includedMinutes={1200} />,
    );
    expect(screen.getByText('0min de 20h')).toBeInTheDocument();
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '0');

    rerender(<BalanceMeter packageMinutes={1300} includedMinutes={1200} />);
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '1200');
  });
});
