import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiError } from '../../../test/msw/handlers';
import { server } from '../../../test/msw/server';
import { renderWithProviders } from '../../../test/render-with-providers';
import { RoomsSection } from './RoomsSection';

const render = (ui: React.ReactElement) => renderWithProviders(ui);

describe('RoomsSection with the API unavailable (static reference rooms)', () => {
  beforeEach(() => {
    server.use(http.get('*/api/public/rooms', () => apiError(404, 'NOT_FOUND', 'Indisponível.')));
  });

  it('is the #salas section with the heading and the unified-tariff pill', () => {
    const { container } = render(<RoomsSection onReserve={vi.fn()} />);

    expect(container.querySelector('section')).toHaveAttribute('id', 'salas');
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

  it('leads each card with the clinic photo and the tags, leaving the equipment list to the room page', () => {
    render(<RoomsSection onReserve={vi.fn()} />);

    expect(screen.getByText('Criadores de Conteúdo')).toBeInTheDocument();
    expect(screen.queryByText('Maca reclinável hidráulica ultra-conforto')).not.toBeInTheDocument();
    const srcs = screen.getAllByRole('img').map((img) => img.getAttribute('src'));
    expect(srcs).toEqual([
      '/images/sala-principal-800.webp',
      '/images/sala-secundaria.webp',
      '/images/sala-terceira.webp',
    ]);
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

describe('RoomsSection with live rooms (NUC-181)', () => {
  it('renders the rooms of the API: ideal-for tags, cover and the reference chip', async () => {
    render(<RoomsSection onReserve={vi.fn()} />);

    expect(await screen.findByText('Nutrição')).toBeInTheDocument();
    const cards = screen.getAllByRole('article');
    expect(cards).toHaveLength(3);
    expect(within(cards[0] as HTMLElement).getByRole('img')).toHaveAttribute(
      'src',
      '/media/principal-large.webp',
    );
    expect(within(cards[0] as HTMLElement).getByText('Filmagem & Estúdio')).toBeInTheDocument();
    expect(within(cards[1] as HTMLElement).getByRole('img')).toHaveAttribute(
      'src',
      '/images/sala-secundaria.webp',
    );
  });

  it('shows the price from the API ("A partir de" R$ 80,00) and reports the room slug', async () => {
    const onReserve = vi.fn();
    render(<RoomsSection onReserve={onReserve} />);
    await screen.findByText('Nutrição');

    const second = screen.getAllByRole('article')[1] as HTMLElement;
    expect(within(second).getByText(/R\$\s80,00/)).toBeInTheDocument();
    await userEvent.click(within(second).getByRole('button', { name: 'Reservar Sala' }));

    expect(onReserve).toHaveBeenCalledWith('secundaria');
  });
});
