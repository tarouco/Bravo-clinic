import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { spaced } from '../../test/text';
import { StatTile } from './StatTile';

describe('StatTile', () => {
  it('shows the value in BRL and a positive delta with its sign', () => {
    render(
      <StatTile
        label="Receita líquida"
        valueCents={160000}
        delta={{ cents: 17800, percent: 12.5 }}
        deltaLabel="vs. período anterior"
      />,
    );

    expect(screen.getByText('Receita líquida')).toBeInTheDocument();
    expect(screen.getByText(spaced('R$ 1.600,00'))).toBeInTheDocument();
    expect(screen.getByText('+12,5%')).toBeInTheDocument();
    expect(screen.getByText('vs. período anterior')).toBeInTheDocument();
  });

  it('shows a negative delta with one decimal and a dash when the percentage is null', () => {
    const { rerender } = render(
      <StatTile label="Resultado" valueCents={50000} delta={{ cents: -3000, percent: -3 }} />,
    );
    expect(screen.getByText('-3,0%')).toBeInTheDocument();

    rerender(
      <StatTile label="Resultado" valueCents={50000} delta={{ cents: 50000, percent: null }} />,
    );
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders the gold tone with every line in on-gold, even a bad delta', () => {
    const { container } = render(
      <StatTile
        tone="gold"
        label="Resultado"
        valueCents={1000}
        delta={{ cents: 500, percent: 5 }}
        higherIsBetter={false}
      />,
    );
    expect(container.firstChild).toHaveClass('bg-grad-gold', 'text-on-gold');
    expect(screen.getByText('Resultado')).toHaveClass('text-on-gold');
    expect(screen.getByText('+5,0%').parentElement).toHaveClass('text-on-gold');
    expect(screen.getByText('+5,0%').parentElement).not.toHaveClass('text-danger');
  });

  it('omits the delta line when there is no comparison', () => {
    render(<StatTile label="Despesas" valueCents={0} />);

    expect(screen.getByText(spaced('R$ 0,00'))).toBeInTheDocument();
    expect(screen.queryByText('—')).not.toBeInTheDocument();
  });

  it('paints a rise as bad only when higher is not better (expenses)', () => {
    const { rerender } = render(
      <StatTile
        label="Despesas"
        valueCents={1000}
        delta={{ cents: 500, percent: 50 }}
        higherIsBetter={false}
      />,
    );
    expect(screen.getByText('+50,0%').closest('p')).toHaveClass('text-danger');

    rerender(<StatTile label="Receita" valueCents={1000} delta={{ cents: 500, percent: 50 }} />);
    expect(screen.getByText('+50,0%').closest('p')).not.toHaveClass('text-danger');
  });
});
