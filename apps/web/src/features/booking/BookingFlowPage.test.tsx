import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/render-with-providers';
import { BookingFlowPage } from './BookingFlowPage';

// Only `Date` is faked, so timers, MSW and Testing Library keep running normally.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-20T15:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

function Where() {
  const { pathname, search } = useLocation();
  return <output data-testid="where">{`${pathname}${search}`}</output>;
}

function renderFlow(route: string) {
  return renderWithProviders(
    <>
      <Routes>
        <Route path="/reservar" element={<BookingFlowPage />} />
        <Route path="/app/reservar" element={<BookingFlowPage />} />
      </Routes>
      <Where />
    </>,
    route,
  );
}

const where = () => screen.getByTestId('where').textContent ?? '';
const params = () => new URLSearchParams(where().split('?')[1] ?? '');

describe('BookingFlowPage steps (NUC-98)', () => {
  it('shows exactly the four steps Sala e data, Horário, Resumo, Pagamento', async () => {
    renderFlow('/reservar');

    const stepper = await screen.findByRole('navigation', { name: 'Etapas da reserva' });
    expect(
      within(stepper)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['1Sala e data', '2Horário', '3Resumo', '4Pagamento']);
    expect(within(stepper).getByText('Sala e data').closest('li')).toHaveAttribute(
      'aria-current',
      'step',
    );
  });

  it('prefills from the URL and skips to Horário when room and date are given', async () => {
    renderFlow('/reservar?sala=principal&data=2026-10-27&inicio=1050&fim=1200');

    const stepper = screen.getByRole('navigation', { name: 'Etapas da reserva' });
    expect(within(stepper).getByText('Horário').closest('li')).toHaveAttribute(
      'aria-current',
      'step',
    );
    expect(await screen.findByRole('button', { name: /^17:30/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(await screen.findByRole('button', { name: '2h30' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeEnabled();
  });

  it('picks room and date on the first step and moves on to Horário', async () => {
    renderFlow('/reservar');

    await userEvent.click(await screen.findByRole('radio', { name: /Sala Secundária/ }));
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled();
    await userEvent.click(await screen.findByRole('button', { name: /^28 de outubro/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }));

    expect(params().get('sala')).toBe('secundaria');
    expect(params().get('data')).toBe('2026-10-28');
    expect(params().get('etapa')).toBe('horario');
    expect(await screen.findByRole('list', { name: 'Horários de início' })).toBeInTheDocument();
  });

  it('writes the chosen start and duration to the URL and enables Continuar', async () => {
    renderFlow('/reservar?sala=principal&data=2026-10-27');

    await userEvent.click(await screen.findByRole('button', { name: /^11:30/ }));
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: '1h30' }));

    expect(params().get('inicio')).toBe('690');
    expect(params().get('fim')).toBe('780');
    expect(params().get('bloco')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(params().get('etapa')).toBe('resumo');
  });

  it('sets bloco=<id> and clears the interval when a block option is chosen', async () => {
    renderFlow('/reservar?sala=principal&data=2026-10-28&inicio=600&fim=720');

    await userEvent.click(await screen.findByRole('button', { name: /Meio turno comercial/ }));

    expect(params().get('bloco')).toBe('33333333-3333-4333-8333-555555555555');
    expect(params().get('inicio')).toBeNull();
    expect(params().get('fim')).toBeNull();
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeEnabled();
  });

  it('keeps the selection when going back to Sala e data', async () => {
    renderFlow('/reservar?sala=principal&data=2026-10-27&inicio=1050&fim=1200');
    await screen.findByRole('button', { name: '2h30' });

    await userEvent.click(screen.getByRole('button', { name: 'Voltar' }));

    expect(params().get('etapa')).toBe('data');
    expect(params().get('inicio')).toBe('1050');
    expect(params().get('fim')).toBe('1200');
    expect(await screen.findByRole('radio', { name: /Sala Principal/ })).toBeChecked();
    expect(await screen.findByRole('button', { name: /^27 de outubro/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('drops the time selection when another date is picked', async () => {
    renderFlow('/reservar?sala=principal&data=2026-10-27&inicio=1050&fim=1200&etapa=data');

    await userEvent.click(await screen.findByRole('button', { name: /^28 de outubro/ }));

    expect(params().get('data')).toBe('2026-10-28');
    expect(params().get('inicio')).toBeNull();
    expect(params().get('fim')).toBeNull();
  });

  it('works under /app/reservar with the same parameters', async () => {
    renderFlow('/app/reservar?sala=principal&data=2026-10-27');

    await userEvent.click(await screen.findByRole('button', { name: /^11:30/ }));

    expect(where().startsWith('/app/reservar?')).toBe(true);
    expect(params().get('inicio')).toBe('690');
  });

  it('tracks select_slot when a start and duration are chosen', async () => {
    vi.stubEnv('VITE_GA4_ID', 'G-TEST123');
    window.dataLayer = [];
    try {
      renderFlow('/reservar?sala=principal&data=2026-10-27');
      await userEvent.click(await screen.findByRole('button', { name: /^11:30/ }));
      await userEvent.click(screen.getByRole('button', { name: '1h30' }));

      expect(window.dataLayer).toContainEqual(
        expect.objectContaining({ event: 'select_slot', room: 'principal', date: '2026-10-27' }),
      );
    } finally {
      vi.unstubAllEnvs();
      delete window.dataLayer;
      document.querySelector('script[data-ga4]')?.remove();
    }
  });
});
