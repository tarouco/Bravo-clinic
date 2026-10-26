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

// The month, week and day views render the whole agenda after MSW answers; a loaded host needs
// more than the default waits, so these waits are explicit instead of relying on global ones.
const SLOW = { timeout: 10_000 } as const;
const TEST_TIMEOUT = 30_000;

describe('AgendaPage (NUC-190)', () => {
  it(
    'starts in the month view with the booking and switches to week and day',
    async () => {
      renderAgenda();

      expect(
        await screen.findByRole('button', { name: /17:30 Sala Principal/ }, SLOW),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Mês anterior' })).toBeInTheDocument();

      await userEvent.click(screen.getByRole('tab', { name: 'Semana' }));
      expect(
        await screen.findByRole('button', { name: /Sala Principal, 17:30–20:00/ }, SLOW),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Semana anterior' })).toBeInTheDocument();

      await userEvent.click(screen.getByRole('tab', { name: 'Dia' }));
      expect(
        await screen.findByRole('button', { name: /Sala Principal, 17:30–20:00/ }, SLOW),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Dia anterior' })).toBeInTheDocument();
    },
    TEST_TIMEOUT,
  );

  it(
    'does not show the cleanup band after the booking',
    async () => {
      const { container } = renderAgenda();
      await userEvent.click(await screen.findByRole('tab', { name: 'Semana' }, SLOW));
      await screen.findByRole('button', { name: /Sala Principal, 17:30–20:00/ }, SLOW);

      expect(container.querySelector('[data-kind="cleanup"]')).toBeNull();
    },
    TEST_TIMEOUT,
  );

  it(
    'opens the booking detail from an event',
    async () => {
      renderAgenda();
      await userEvent.click(await screen.findByRole('tab', { name: 'Semana' }, SLOW));

      await userEvent.click(
        await screen.findByRole('button', { name: /Sala Principal, 17:30–20:00/ }, SLOW),
      );

      expect(await screen.findByText('detalhe da reserva', {}, SLOW)).toBeInTheDocument();
    },
    TEST_TIMEOUT,
  );
});
