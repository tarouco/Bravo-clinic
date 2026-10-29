import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ArrowRight } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button';

describe('Button', () => {
  it('renders the primary variant by default as the emerald relief pill, sentence case', () => {
    render(<Button>Reservar</Button>);
    const button = screen.getByRole('button', { name: 'Reservar' });
    expect(button).toHaveClass('bv-btn', 'bv-btn--emerald');
    expect(button).not.toHaveClass('uppercase');
    expect(button).toHaveAttribute('type', 'button');
  });

  it.each([
    ['secondary', 'bv-btn--pearl'],
    ['gold', 'bv-btn--gold'],
    ['brown', 'bv-btn--brown'],
  ] as const)('renders the %s variant as %s', (variant, kitClass) => {
    render(<Button variant={variant}>Cancelar</Button>);
    expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveClass('bv-btn', kitClass);
  });

  it('renders the ghost variant as a pill without relief, ink text and a translucent hover', () => {
    render(<Button variant="ghost">Voltar</Button>);
    const button = screen.getByRole('button', { name: 'Voltar' });
    expect(button).toHaveClass('bv-btn', 'bg-transparent', 'shadow-none', 'text-ink');
    expect(button).toHaveClass('hover:bg-glass-hover');
    expect(button).not.toHaveClass('bv-btn--emerald');
  });

  it('renders the link variant in accent with an underline and the accent focus ring', () => {
    render(<Button variant="link">Saiba mais</Button>);
    const button = screen.getByRole('button', { name: 'Saiba mais' });
    expect(button).toHaveClass('bg-transparent', 'underline', 'text-accent');
    expect(button).toHaveClass('focus-visible:ring-2', 'focus-visible:ring-accent');
    expect(button).not.toHaveClass('bv-btn');
  });

  it('renders the sm size as bv-btn--sm and the block button full width', () => {
    render(
      <>
        <Button size="sm">Pequeno</Button>
        <Button size="md">Médio</Button>
        <Button block>Confirmar</Button>
      </>,
    );
    expect(screen.getByRole('button', { name: 'Pequeno' })).toHaveClass('bv-btn--sm');
    expect(screen.getByRole('button', { name: 'Médio' })).not.toHaveClass('bv-btn--sm');
    expect(screen.getByRole('button', { name: 'Confirmar' })).toHaveClass('bv-btn--block');
  });

  it('lights up for 1.6 s after a click', () => {
    vi.useFakeTimers();
    try {
      render(<Button>Reservar</Button>);
      const button = screen.getByRole('button', { name: 'Reservar' });
      fireEvent.click(button);
      expect(button).toHaveClass('is-lit');
      act(() => {
        vi.advanceTimersByTime(1600);
      });
      expect(button).not.toHaveClass('is-lit');
    } finally {
      vi.useRealTimers();
    }
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

  it('leaves the keyboard focus outline to bv-btn (bv.css), without ring utilities', () => {
    render(<Button>Foco</Button>);
    const button = screen.getByRole('button', { name: 'Foco' });
    expect(button).toHaveClass('bv-btn');
    expect(button).not.toHaveClass('focus-visible:ring-2');
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
    expect(link).toHaveClass('bv-btn', 'bv-btn--emerald');
    expect(screen.queryByRole('button')).toBeNull();
  });
});
