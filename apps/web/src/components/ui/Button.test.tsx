import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ArrowRight } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button';

describe('Button', () => {
  it('renders the primary variant by default with bronze background, on-bronze text, h-12 and a 2px radius', () => {
    render(<Button>Reservar</Button>);
    const button = screen.getByRole('button', { name: 'Reservar' });
    expect(button).toHaveClass('bg-bronze', 'text-on-bronze', 'h-12', 'rounded-control');
    expect(button).toHaveAttribute('type', 'button');
  });

  it('renders the secondary variant with raised surface, a border and ink text', () => {
    render(<Button variant="secondary">Cancelar</Button>);
    expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveClass(
      'bg-surface-raised',
      'border',
      'border-border',
      'text-ink',
    );
  });

  it('renders the ghost variant with a transparent background', () => {
    render(<Button variant="ghost">Voltar</Button>);
    expect(screen.getByRole('button', { name: 'Voltar' })).toHaveClass('bg-transparent');
  });

  it('renders the link variant with a transparent background and underline', () => {
    render(<Button variant="link">Saiba mais</Button>);
    expect(screen.getByRole('button', { name: 'Saiba mais' })).toHaveClass(
      'bg-transparent',
      'underline',
    );
  });

  it('renders the sm size as h-10 and the md size as h-12', () => {
    render(
      <>
        <Button size="sm">Pequeno</Button>
        <Button size="md">Médio</Button>
      </>,
    );
    expect(screen.getByRole('button', { name: 'Pequeno' })).toHaveClass('h-10');
    expect(screen.getByRole('button', { name: 'Médio' })).toHaveClass('h-12');
  });

  it('is disabled with aria-busy and does not call onClick while loading', async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Salvar
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Salvar' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('is not busy and calls onClick once when not loading', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Salvar</Button>);
    const button = screen.getByRole('button', { name: 'Salvar' });
    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute('aria-busy');
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('carries the 2px accent focus-visible ring with a 2px offset', () => {
    render(<Button>Foco</Button>);
    expect(screen.getByRole('button', { name: 'Foco' })).toHaveClass(
      'focus-visible:ring-2',
      'focus-visible:ring-accent',
      'focus-visible:ring-offset-2',
    );
  });

  it('renders leading and trailing icons as decorative svgs', () => {
    const { container } = render(
      <Button leadingIcon={ArrowRight} trailingIcon={ArrowRight}>
        Avançar
      </Button>,
    );
    const svgs = container.querySelectorAll('svg');
    expect(svgs).toHaveLength(2);
    svgs.forEach((svg) => expect(svg).toHaveAttribute('aria-hidden', 'true'));
  });

  it('asChild renders the child element (a link) with the button classes and keeps its href', () => {
    render(
      <Button asChild>
        <a href="/app/reservar">Reservar sala</a>
      </Button>,
    );
    const link = screen.getByRole('link', { name: 'Reservar sala' });
    expect(link).toHaveAttribute('href', '/app/reservar');
    expect(link).toHaveClass('bg-bronze', 'text-on-bronze', 'h-12', 'rounded-control');
    expect(screen.queryByRole('button')).toBeNull();
  });
});
