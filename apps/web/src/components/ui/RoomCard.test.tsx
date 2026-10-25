import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Video } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { RoomCard, type RoomCardProps } from './RoomCard';

const base: RoomCardProps = {
  name: 'Sala Principal',
  featureChip: { label: 'Filmagem & Estúdio', icon: Video },
  tags: ['Médico', 'Estética Avançada'],
  description: 'Espaço flagship com maca motorizada.',
  equipment: ['Maca motorizada', 'Mesa executiva', 'Pia de assepsia'],
  fromPriceCents: 8000,
  onReserve: () => undefined,
};

describe('RoomCard', () => {
  it('renders the name heading, name chip, feature chip, tags and description', () => {
    render(<RoomCard {...base} imageUrl="/sala.webp" />);
    expect(screen.getByRole('heading', { name: 'Sala Principal' })).toBeInTheDocument();
    expect(screen.getAllByText('Sala Principal')).toHaveLength(2);
    expect(screen.getByText('Filmagem & Estúdio')).toBeInTheDocument();
    expect(screen.getByText('Médico')).toBeInTheDocument();
    expect(screen.getByText('Estética Avançada')).toBeInTheDocument();
    expect(screen.getByText('Espaço flagship com maca motorizada.')).toBeInTheDocument();
  });

  it('renders one list item per equipment entry', () => {
    render(<RoomCard {...base} />);
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'Maca motorizada',
      'Mesa executiva',
      'Pia de assepsia',
    ]);
  });

  it('shows "A partir de", the formatted price and "/h" for fromPriceCents = 8000', () => {
    render(<RoomCard {...base} />);
    expect(screen.getByText('A partir de')).toBeInTheDocument();
    expect(screen.getByText('R$ 80,00')).toBeInTheDocument();
    expect(screen.getByText('/h')).toBeInTheDocument();
  });

  it('uses the given image url as the cover', () => {
    render(<RoomCard {...base} imageUrl="/sala.webp" />);
    expect(screen.getByRole('img')).toHaveAttribute('src', '/sala.webp');
  });

  it('falls back to /room-placeholder.webp with a non-empty alt text when imageUrl is undefined', () => {
    render(<RoomCard {...base} imageUrl={undefined} />);
    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', '/room-placeholder.webp');
    expect(img.getAttribute('alt')).toBeTruthy();
  });

  it('calls onReserve once when "Reservar Sala" is clicked', async () => {
    const onReserve = vi.fn();
    render(<RoomCard {...base} onReserve={onReserve} />);
    await userEvent.click(screen.getByRole('button', { name: 'Reservar Sala' }));
    expect(onReserve).toHaveBeenCalledTimes(1);
  });
});
