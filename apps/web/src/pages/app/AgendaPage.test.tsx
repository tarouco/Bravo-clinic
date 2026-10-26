import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/render-with-providers';
import { AgendaPage } from './AgendaPage';

// Only `Date` is faked, so timers, MSW and Testing Library keep running normally.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-27T15:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

function renderAgenda() {
  return renderWithProviders(
    <Routes>
      <Route path="/app/agenda" element={<AgendaPage />} />
      <Route path="/app/minhas-reservas/:id" element={<p>detalhe da reserva</p>} />
    </Routes>,
    '/app/agenda',
  );
}

describe('AgendaPage (NUC-190)', () => {
  it('starts in the month view with the booking and switches to week and day', async () => {
    renderAgenda();

    expect(await screen.findByRole('button', { name: /17:30 Sala Principal/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mês anterior' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Semana' }));
    expect(
      await screen.findByRole('button', { name: /Sala Principal, 17:30–20:00/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Semana anterior' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Dia' }));
    expect(
      await screen.findByRole('button', { name: /Sala Principal, 17:30–20:00/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dia anterior' })).toBeInTheDocument();
  });

  it('does not show the cleanup band after the booking', async () => {
    const { container } = renderAgenda();
    await userEvent.click(await screen.findByRole('tab', { name: 'Semana' }));
    await screen.findByRole('button', { name: /Sala Principal, 17:30–20:00/ });

    expect(container.querySelector('[data-kind="cleanup"]')).toBeNull();
  });

  it('opens the booking detail from an event', async () => {
    renderAgenda();
    await userEvent.click(await screen.findByRole('tab', { name: 'Semana' }));

    await userEvent.click(
      await screen.findByRole('button', { name: /Sala Principal, 17:30–20:00/ }),
    );

    expect(await screen.findByText('detalhe da reserva')).toBeInTheDocument();
  });
});
