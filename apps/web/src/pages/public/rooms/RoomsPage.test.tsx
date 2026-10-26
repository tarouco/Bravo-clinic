import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { disableAnalytics, enableGa4, gtagEvents } from '../../../test/analytics';
import { apiError } from '../../../test/msw/handlers';
import { server } from '../../../test/msw/server';
import { renderWithProviders } from '../../../test/render-with-providers';
import { RoomsPage } from './RoomsPage';

function renderPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/salas" element={<RoomsPage />} />
      <Route path="/salas/:slug" element={<p>Página da sala</p>} />
    </Routes>,
    '/salas',
  );
}

afterEach(() => {
  disableAnalytics();
});

describe('RoomsPage (NUC-180)', () => {
  it('renders one card per room with "A partir de R$ 80,00/h" and the ideal-for tags', async () => {
    renderPage();

    const cards = await screen.findAllByRole('article');
    expect(cards).toHaveLength(3);
    for (const card of cards) {
      expect(within(card).getByText('A partir de')).toBeInTheDocument();
      expect(within(card).getByText(/R\$\s80,00/)).toBeInTheDocument();
      expect(within(card).getByText('/h')).toBeInTheDocument();
    }
    expect(within(cards[0] as HTMLElement).getByText('Médico')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'As salas inteligentes da clínica.',
    );
  });

  it('uses the cover of a room that has one and the placeholder when the cover is null', async () => {
    renderPage();

    const cards = await screen.findAllByRole('article');
    expect(within(cards[0] as HTMLElement).getByRole('img')).toHaveAttribute(
      'src',
      '/media/principal-large.webp',
    );
    expect(within(cards[1] as HTMLElement).getByRole('img')).toHaveAttribute(
      'src',
      '/room-placeholder.webp',
    );
    expect(within(cards[2] as HTMLElement).getByRole('img')).toHaveAttribute(
      'src',
      '/room-placeholder.webp',
    );
  });

  it('opens the room page and tracks view_room when a card is clicked', async () => {
    enableGa4();
    renderPage();
    const cards = await screen.findAllByRole('article');

    await userEvent.click(
      within(cards[1] as HTMLElement).getByRole('button', { name: 'Reservar Sala' }),
    );

    expect(await screen.findByText('Página da sala')).toBeInTheDocument();
    const events = gtagEvents().filter((event) => event.name === 'view_room');
    expect(events).toHaveLength(1);
    expect(events[0]?.params).toMatchObject({ roomSlug: 'secundaria' });
    expect(events[0]?.params).not.toHaveProperty('name');
  });

  it('shows an error with a retry when the rooms cannot be loaded', async () => {
    server.use(http.get('*/api/public/rooms', () => apiError(404, 'NOT_FOUND', 'Erro.')));
    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível carregar as salas agora.',
    );
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument();
  });
});
