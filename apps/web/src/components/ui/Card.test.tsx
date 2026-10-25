import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Badge } from './Badge';
import { Card } from './Card';

describe('Card', () => {
  it('renders the raised variant by default with raised surface, 1px hairline border and 8px radius', () => {
    render(<Card data-testid="card">Conteúdo</Card>);
    expect(screen.getByTestId('card')).toHaveClass(
      'bg-surface-raised',
      'border',
      'border-hairline',
      'rounded-card',
    );
  });

  it('renders the walnut variant with a walnut background', () => {
    render(
      <Card variant="walnut" data-testid="card">
        Faixa
      </Card>,
    );
    expect(screen.getByTestId('card')).toHaveClass('bg-walnut');
  });

  it('renders the stone variant with a stone background', () => {
    render(
      <Card variant="stone" data-testid="card">
        Repouso
      </Card>,
    );
    expect(screen.getByTestId('card')).toHaveClass('bg-surface-stone');
  });

  it('renders the media slot before the content with square corners', () => {
    render(
      <Card data-testid="card" media={<img alt="Sala" src="/x.webp" />}>
        Conteúdo
      </Card>,
    );
    const card = screen.getByTestId('card');
    const mediaWrapper = screen.getByAltText('Sala').parentElement;
    expect(card.firstElementChild).toBe(mediaWrapper);
    expect(mediaWrapper).toHaveClass('rounded-none');
    expect(card.lastElementChild).toHaveTextContent('Conteúdo');
  });
});

describe('Badge', () => {
  it('renders champagne-soft background, on-champagne text, uppercase caption with .08em tracking', () => {
    render(<Badge>Médico</Badge>);
    expect(screen.getByText('Médico')).toHaveClass(
      'bg-champagne-soft',
      'text-on-champagne',
      'uppercase',
      'text-caption',
      'tracking-[0.08em]',
    );
  });

  it('renders the neutral tone without the champagne background', () => {
    render(<Badge tone="neutral">Inativa</Badge>);
    const badge = screen.getByText('Inativa');
    expect(badge).toHaveClass('bg-surface-stone');
    expect(badge).not.toHaveClass('bg-champagne-soft');
  });
});
