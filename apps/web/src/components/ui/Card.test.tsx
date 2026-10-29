import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Badge } from './Badge';
import { Card } from './Card';

describe('Card', () => {
  it('renders the raised variant by default as the pearl bv-card with the body padded inside', () => {
    render(<Card data-testid="card">Conteúdo</Card>);
    const card = screen.getByTestId('card');
    expect(card).toHaveClass('bv-card', 'p-0');
    expect(card).not.toHaveClass('bv-card--gold', 'bv-card--emerald');
    expect(card.lastElementChild).toHaveClass('p-space-lg');
  });

  it.each([
    ['emerald', 'bv-card--emerald'],
    ['walnut', 'bv-card--emerald'],
    ['gold', 'bv-card--gold'],
  ] as const)('renders the %s variant as %s', (variant, kitClass) => {
    render(
      <Card variant={variant} data-testid="card">
        Destaque
      </Card>,
    );
    expect(screen.getByTestId('card')).toHaveClass('bv-card', kitClass);
  });

  it('renders the stone variant on the panel tone', () => {
    render(
      <Card variant="stone" data-testid="card">
        Repouso
      </Card>,
    );
    expect(screen.getByTestId('card')).toHaveClass('bv-card', 'bg-surface-panel');
  });

  it('renders the media slot before the content, clipped by the rounded card', () => {
    render(
      <Card data-testid="card" media={<img alt="Sala" src="/x.webp" />}>
        Conteúdo
      </Card>,
    );
    const card = screen.getByTestId('card');
    const mediaWrapper = screen.getByAltText('Sala').parentElement;
    expect(card.firstElementChild).toBe(mediaWrapper);
    expect(card).toHaveClass('overflow-hidden');
    expect(card.lastElementChild).toHaveTextContent('Conteúdo');
  });

  it('hangs past the panel edge on request', () => {
    render(
      <>
        <Card overhang="end" data-testid="end">
          Fim
        </Card>
        <Card overhang="start" data-testid="start">
          Início
        </Card>
      </>,
    );
    expect(screen.getByTestId('end')).toHaveClass('bv-overhang-end');
    expect(screen.getByTestId('start')).toHaveClass('bv-overhang-start');
  });
});

describe('Badge', () => {
  it('renders a gold pill with on-gold sentence-case caption by default', () => {
    render(<Badge>Médico</Badge>);
    const badge = screen.getByText('Médico');
    expect(badge).toHaveClass('rounded-pill', 'bg-gold', 'text-on-gold', 'text-caption');
    expect(badge).not.toHaveClass('uppercase');
  });

  it.each([
    ['neutral', ['bg-surface-deboss', 'text-ink-muted']],
    ['bronze', ['bg-emerald', 'text-on-emerald']],
    ['emerald', ['bg-emerald', 'text-on-emerald']],
    ['error', ['bg-danger-soft', 'text-danger']],
    ['danger', ['bg-danger-soft', 'text-danger']],
    ['champagne', ['bg-gold', 'text-on-gold']],
  ] as const)('renders the %s tone', (tone, classes) => {
    render(<Badge tone={tone}>Situação</Badge>);
    expect(screen.getByText('Situação')).toHaveClass(...classes);
  });
});
