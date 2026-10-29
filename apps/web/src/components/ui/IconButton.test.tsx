import { act, fireEvent, render, screen } from '@testing-library/react';
import { Plus, Search } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { IconButton, iconButtonClasses } from './IconButton';

describe('IconButton', () => {
  it('is named by its required label and hides the glyph from assistive technology', () => {
    const { container } = render(<IconButton icon={Search} label="Buscar" />);
    const button = screen.getByRole('button', { name: 'Buscar' });
    expect(button).toHaveAttribute('aria-label', 'Buscar');
    expect(button).toHaveAttribute('type', 'button');
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('requires a label at the type level', () => {
    // @ts-expect-error `label` is required: an icon button is never nameless.
    render(<IconButton icon={Search} />);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('renders the pearl md button by default and the tone and sm size on request', () => {
    render(
      <>
        <IconButton icon={Search} label="Buscar" />
        <IconButton icon={Plus} label="Nova reserva" tone="emerald" size="sm" />
      </>,
    );
    expect(screen.getByRole('button', { name: 'Buscar' })).toHaveClass(
      'bv-icon-btn',
      'bv-btn--pearl',
    );
    expect(screen.getByRole('button', { name: 'Buscar' })).not.toHaveClass('bv-icon-btn--sm');
    expect(screen.getByRole('button', { name: 'Nova reserva' })).toHaveClass(
      'bv-icon-btn',
      'bv-btn--emerald',
      'bv-icon-btn--sm',
    );
  });

  it('calls onClick and lights up for 1.6 s, but not while disabled', () => {
    vi.useFakeTimers();
    try {
      const onClick = vi.fn();
      render(
        <>
          <IconButton icon={Search} label="Buscar" onClick={onClick} />
          <IconButton icon={Plus} label="Adicionar" disabled />
        </>,
      );
      const search = screen.getByRole('button', { name: 'Buscar' });
      fireEvent.click(search);
      expect(onClick).toHaveBeenCalledTimes(1);
      expect(search).toHaveClass('is-lit');
      act(() => {
        vi.advanceTimersByTime(1600);
      });
      expect(search).not.toHaveClass('is-lit');

      const add = screen.getByRole('button', { name: 'Adicionar' });
      fireEvent.click(add);
      expect(add).toBeDisabled();
      expect(add).not.toHaveClass('is-lit');
    } finally {
      vi.useRealTimers();
    }
  });

  it('exposes the same look for links through iconButtonClasses', () => {
    expect(iconButtonClasses({ tone: 'gold', size: 'sm' })).toBe(
      'bv-icon-btn bv-btn--gold bv-icon-btn--sm',
    );
  });
});
