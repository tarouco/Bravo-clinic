import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { spaced } from '../../test/text';
import { EvolutionChart, niceTicks, type EvolutionBucket } from './EvolutionChart';

const BUCKETS: EvolutionBucket[] = [
  {
    key: '2026-09',
    label: 'set/2026',
    netCents: 100000,
    expensesCents: -40000,
    resultCents: 60000,
  },
  {
    key: '2026-10',
    label: 'out/2026',
    netCents: 160000,
    expensesCents: -50000,
    resultCents: 110000,
  },
  {
    key: '2026-11',
    label: 'nov/2026',
    netCents: 20000,
    expensesCents: -50000,
    resultCents: -30000,
  },
];

describe('EvolutionChart', () => {
  it('draws one group per bucket with a bar per bar series and a marker for the result', () => {
    const { container } = render(<EvolutionChart buckets={BUCKETS} />);

    const groups = container.querySelectorAll('[data-bucket]');
    expect(Array.from(groups).map((g) => g.getAttribute('data-bucket'))).toEqual([
      '2026-09',
      '2026-10',
      '2026-11',
    ]);
    expect(groups[0]?.querySelectorAll('path')).toHaveLength(2);
    expect(container.querySelectorAll('circle')).toHaveLength(3);
    expect(container.querySelectorAll('polyline')).toHaveLength(1);
  });

  it('shows a legend with the three series', () => {
    render(<EvolutionChart buckets={BUCKETS} />);

    const legend = screen.getByRole('list', { name: 'Legenda' });
    expect(
      within(legend)
        .getAllByRole('listitem')
        .map((i) => i.textContent),
    ).toEqual(['Receita líquida', 'Despesas', 'Resultado']);
  });

  it('offers a table with the same numbers (expenses as a magnitude)', () => {
    render(<EvolutionChart buckets={BUCKETS} caption="Evolução de set a nov" />);

    const table = screen.getByRole('table', { name: 'Evolução de set a nov' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(4);
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual(['Período', 'Receita líquida', 'Despesas', 'Resultado']);
    const outubro = within(rows[2] as HTMLElement).getAllByRole('cell');
    expect(outubro.map((c) => c.textContent?.replace(/\s/g, ' '))).toEqual([
      'R$ 1.600,00',
      'R$ 500,00',
      'R$ 1.100,00',
    ]);
    expect(within(rows[3] as HTMLElement).getByText(spaced('-R$ 300,00'))).toBeInTheDocument();
  });

  it('hatches the expenses bars so they differ from net revenue by texture, not only by hue', () => {
    const { container } = render(<EvolutionChart buckets={BUCKETS} />);

    const pattern = container.querySelector('pattern');
    expect(pattern).not.toBeNull();
    const paths = container.querySelectorAll('[data-bucket="2026-10"] path');
    expect(paths[0]).toHaveClass('fill-emerald');
    expect(paths[1]?.getAttribute('fill')).toBe(`url(#${pattern?.id ?? ''})`);
  });

  it('hides the decorative SVG from assistive technology', () => {
    const { container } = render(<EvolutionChart buckets={BUCKETS} />);

    expect(container.querySelector('svg[viewBox]')).toHaveAttribute('aria-hidden', 'true');
  });

  it('plots only the requested series and drops the legend of a single one', () => {
    const { container } = render(<EvolutionChart buckets={BUCKETS} series={['net']} />);

    expect(screen.queryByRole('list', { name: 'Legenda' })).not.toBeInTheDocument();
    expect(container.querySelectorAll('circle')).toHaveLength(0);
    expect(container.querySelector('[data-bucket] path')).not.toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'Despesas' })).not.toBeInTheDocument();
  });

  it('shows the values of a bucket in a tooltip while the pointer is over it', () => {
    const { container } = render(<EvolutionChart buckets={BUCKETS} />);

    fireEvent.mouseEnter(container.querySelector('[data-bucket="2026-10"]') as Element);
    expect(screen.getByText(spaced('Receita líquida: R$ 1.600,00'))).toBeInTheDocument();

    fireEvent.mouseLeave(container.querySelector('svg[viewBox]') as Element);
    expect(screen.queryByText(spaced('Receita líquida: R$ 1.600,00'))).not.toBeInTheDocument();
  });

  it('says there is nothing to plot for an empty period', () => {
    render(<EvolutionChart buckets={[]} />);

    expect(screen.getByText('Sem dados para o período.')).toBeInTheDocument();
  });
});

describe('niceTicks', () => {
  it('spans zero and the data with round steps', () => {
    expect(niceTicks(0, 160000)).toEqual([0, 50000, 100000, 150000, 200000]);
  });

  it('includes negative values below zero', () => {
    const ticks = niceTicks(-30000, 110000);
    expect(ticks[0]).toBeLessThanOrEqual(-30000);
    expect(ticks).toContain(0);
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(110000);
  });

  it('returns a default axis when everything is zero', () => {
    expect(niceTicks(0, 0)).toEqual([0, 10000]);
  });
});
