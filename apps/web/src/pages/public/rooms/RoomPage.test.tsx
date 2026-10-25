import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../../test/render-with-providers';
import { RoomPage } from './RoomPage';

// Only `Date` is faked, so timers, MSW and Testing Library keep running normally.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-20T15:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

function renderRoom(slug: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/salas/:slug" element={<RoomPage />} />
      <Route path="*" element={<p>outra rota</p>} />
    </Routes>,
    `/salas/${slug}`,
  );
}

describe('RoomPage (NUC-182)', () => {
  it('renders the gallery placeholder, the equipment list and the category rates', async () => {
    renderRoom('secundaria');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Sala Secundária' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAttribute('src', '/room-placeholder.webp');
    const equipment = screen.getByRole('heading', { name: 'Equipamentos' }).closest('section');
    expect(
      within(equipment as HTMLElement)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Maca motorizada', 'Foco cirúrgico', 'Pia de assepsia']);
    expect(await screen.findByText('Categorias e valores')).toBeInTheDocument();
    const text = (document.body.textContent ?? '').replace(/\u00a0/g, ' ');
    expect(text).toContain('R$ 97,00/h');
    expect(text).toContain('R$ 80,00/h');
    expect(text).toContain('valor médio R$ 112,00/h');
  });

  it('shows the photos of the room with thumbnails', async () => {
    renderRoom('principal');

    expect(await screen.findByRole('img', { name: 'Sala Principal' })).toHaveAttribute(
      'src',
      '/media/principal-large.webp',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Foto 2' }));
    expect(screen.getByRole('img', { name: 'Bancada da Sala Principal' })).toBeInTheDocument();
  });

  it('links a chosen day, start and duration to the booking flow', async () => {
    renderRoom('principal');
    await screen.findByRole('heading', { level: 1, name: 'Sala Principal' });

    await userEvent.click(await screen.findByRole('button', { name: /^27 de outubro/ }));
    await userEvent.click(await screen.findByRole('button', { name: /^17:30/ }));
    await userEvent.click(screen.getByRole('button', { name: '2h30' }));

    const link = screen.getByRole('link', { name: 'Reservar este horário' });
    expect(link).toHaveAttribute(
      'href',
      '/reservar?sala=principal&data=2026-10-27&inicio=1050&fim=1200',
    );
    expect(screen.getByText('17:30–20:00 (2h30)')).toBeInTheDocument();
  });

  it('keeps "Reservar este horário" disabled until a start and a duration are chosen', async () => {
    renderRoom('principal');
    await userEvent.click(await screen.findByRole('button', { name: /^27 de outubro/ }));
    await screen.findByRole('button', { name: /^17:30/ });

    expect(screen.getByRole('button', { name: 'Reservar este horário' })).toBeDisabled();
    expect(screen.queryByRole('link', { name: 'Reservar este horário' })).toBeNull();
  });

  it('links a closed block option with the bloco parameter', async () => {
    renderRoom('principal');
    await userEvent.click(await screen.findByRole('button', { name: /^28 de outubro/ }));

    await userEvent.click(await screen.findByRole('button', { name: /Meio turno comercial/ }));

    expect(screen.getByRole('link', { name: 'Reservar este horário' })).toHaveAttribute(
      'href',
      '/reservar?sala=principal&data=2026-10-28&bloco=33333333-3333-4333-8333-555555555555',
    );
  });

  it('marks the Finados holiday on the month calendar', async () => {
    renderRoom('principal');
    await screen.findByRole('heading', { level: 1, name: 'Sala Principal' });

    await userEvent.click(await screen.findByRole('button', { name: 'Próximo mês' }));

    expect(await screen.findByTitle('Feriado: Finados')).toBeInTheDocument();
  });

  it('renders the 404 page for an unknown slug', async () => {
    renderRoom('inexistente');

    expect(
      await screen.findByRole('heading', { name: 'Página não encontrada' }),
    ).toBeInTheDocument();
  });
});
