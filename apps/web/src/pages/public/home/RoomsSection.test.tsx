import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RoomsSection } from './RoomsSection';

describe('RoomsSection', () => {
  it('is the #salas section with eyebrow, heading and the unified-tariff pill', () => {
    const { container } = render(<RoomsSection onReserve={vi.fn()} />);

    expect(container.querySelector('section')).toHaveAttribute('id', 'salas');
    expect(screen.getByText('ESPAÇOS SOB DEMANDA')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: 'As três salas inteligentes da clínica.' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Tarifa unificada: mesmo valor base em todas as salas'),
    ).toBeInTheDocument();
  });

  it('renders the three room cards, each from R$ 80,00 with a "Reservar Sala" button', () => {
    render(<RoomsSection onReserve={vi.fn()} />);

    const titles = screen
      .getAllByRole('heading', { level: 3 })
      .map((heading) => heading.textContent);
    expect(titles).toEqual(['Sala Principal', 'Sala Secundária', 'Sala Terceira']);

    const cards = screen.getAllByRole('article');
    expect(cards).toHaveLength(3);
    for (const card of cards) {
      expect(within(card).getByText(/R\$\s80,00/)).toBeInTheDocument();
      expect(within(card).getByRole('button', { name: 'Reservar Sala' })).toBeInTheDocument();
    }
  });

  it('shows the reference tags and equipment of each room', () => {
    render(<RoomsSection onReserve={vi.fn()} />);

    expect(screen.getByText('Criadores de Conteúdo')).toBeInTheDocument();
    expect(screen.getByText('Maca reclinável hidráulica ultra-conforto')).toBeInTheDocument();
    expect(
      screen.getByText('Toalheiro térmico e higienização hospitalar prévia'),
    ).toBeInTheDocument();
  });

  it("calls onReserve('secundaria') when the second card's button is clicked", async () => {
    const onReserve = vi.fn();
    render(<RoomsSection onReserve={onReserve} />);

    const secondCard = screen.getAllByRole('article')[1];
    if (!secondCard) throw new Error('second room card missing');
    await userEvent.click(within(secondCard).getByRole('button', { name: 'Reservar Sala' }));

    expect(onReserve).toHaveBeenCalledTimes(1);
    expect(onReserve).toHaveBeenCalledWith('secundaria');
  });
});
