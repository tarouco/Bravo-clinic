import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { StructurePage } from './StructurePage';

function renderPage() {
  render(
    <MemoryRouter>
      <StructurePage />
    </MemoryRouter>,
  );
}

describe('StructurePage', () => {
  it('renders the heading and the gallery groups with every clinic photo', () => {
    renderPage();

    expect(
      screen.getByRole('heading', { level: 1, name: 'A estrutura da Bravô Clinic.' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Salas' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Recepção e convivência' }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('figure')).toHaveLength(8);
  });

  it('opens a video in a modal that plays on its own, in a loop, with controls', async () => {
    renderPage();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Conheça a Bravô Clinic/ }));

    const dialog = screen.getByRole('dialog', { name: 'Conheça a Bravô Clinic' });
    const video = dialog.querySelector('video');
    expect(video).toHaveAttribute('src', '/videos/institucional.mp4');
    expect(video).toHaveAttribute('controls');
    expect(video?.autoplay).toBe(true);
    expect(video?.loop).toBe(true);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Fechar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('links on to the rooms and the simulator', () => {
    renderPage();

    expect(screen.getByRole('link', { name: /Ver as salas/ })).toHaveAttribute('href', '/salas');
    expect(screen.getByRole('link', { name: 'Simular o valor da reserva' })).toHaveAttribute(
      'href',
      '/#simulador',
    );
  });
});
