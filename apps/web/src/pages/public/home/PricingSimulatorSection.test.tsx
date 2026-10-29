import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { catalog } from '../../../test/fixtures/nucleo';
import { server } from '../../../test/msw/server';
import { renderWithProviders } from '../../../test/render-with-providers';
import { PricingSimulatorSection } from './PricingSimulatorSection';

const normalize = (text: string | null) => (text ?? '').replace(/\s+/g, ' ').trim();

function renderSection() {
  return renderWithProviders(<PricingSimulatorSection />);
}

/** Serves a catalog where "2 horas ou mais" costs `weekdayRateCents` on weekdays. */
function useCatalogWithTwoHourRate(weekdayRateCents: number) {
  server.use(
    http.get('*/api/public/catalog', () =>
      HttpResponse.json({
        ...catalog,
        hourly: catalog.hourly.map((c) =>
          c.name === '2 horas ou mais' ? { ...c, weekdayRateCents } : c,
        ),
      }),
    ),
  );
}

/** Value shown next to a summary label, whitespace-normalized. */
function valueOf(label: RegExp | string): string {
  const row = screen.getByText(label).closest('div');
  if (!row) throw new Error('summary row not found');
  const value = row.lastElementChild;
  return normalize(value?.textContent ?? null);
}

describe('PricingSimulatorSection', () => {
  it('is the #simulador section', () => {
    const { container } = renderSection();

    expect(container.querySelector('section')).toHaveAttribute('id', 'simulador');
  });

  it('shows the corrected tariff table windows and rows', () => {
    renderSection();

    expect(screen.getByText('Dia Útil — Comercial (07:00 às 19:00)')).toBeInTheDocument();
    expect(screen.getByText('Turno completo comercial (5h)')).toBeInTheDocument();
    expect(screen.getByText('Sábados, Domingos & Feriados (09:00 às 19:00)')).toBeInTheDocument();
    expect(screen.queryByText(/às 18:30/)).not.toBeInTheDocument();
    expect(screen.queryByText(/5h30/)).not.toBeInTheDocument();
  });

  it('shows the cleanup guarantee card', () => {
    renderSection();

    expect(
      screen.getByRole('heading', {
        level: 4,
        name: 'Garantia de biossegurança: bloqueio de limpeza de 30 min',
      }),
    ).toBeInTheDocument();
  });

  it('defaults to Dia útil comercial, 2 hours: total R$ 160,00, sinal R$ 80,00, saldo R$ 80,00', () => {
    renderSection();

    expect(valueOf('Valor total da reserva:')).toBe('R$ 160,00');
    expect(valueOf(/Sinal 50% no checkout/)).toBe('R$ 80,00');
    expect(valueOf(/Saldo 50% restante/)).toBe('R$ 80,00');
    expect(screen.getByText('2 Horas')).toBeInTheDocument();
    expect(normalize(screen.getByText(/Tarifa Desconto/).textContent)).toBe(
      '2.0h × R$ 80,00/h (Tarifa Desconto)',
    );
    expect(screen.getByRole('button', { name: 'Dia útil comercial' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Noite / fim de semana' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('switching to Noite / fim de semana shows R$ 198,00 and flips aria-pressed', async () => {
    renderSection();

    await userEvent.click(screen.getByRole('button', { name: 'Noite / fim de semana' }));

    expect(valueOf('Valor total da reserva:')).toBe('R$ 198,00');
    expect(valueOf(/Sinal 50% no checkout/)).toBe('R$ 99,00');
    expect(screen.getByRole('button', { name: 'Noite / fim de semana' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Dia útil comercial' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('moving the slider to 1 hour on Noite / fim de semana shows R$ 120,00', async () => {
    renderSection();
    await userEvent.click(screen.getByRole('button', { name: 'Noite / fim de semana' }));

    fireEvent.keyDown(screen.getByRole('slider', { name: 'Duração da sessão' }), { key: 'Home' });

    expect(valueOf('Valor total da reserva:')).toBe('R$ 120,00');
    expect(screen.getByText('1 Hora')).toBeInTheDocument();
  });

  it('1 hour on Dia útil comercial shows R$ 97,00 and the plain formula', () => {
    renderSection();

    fireEvent.keyDown(screen.getByRole('slider', { name: 'Duração da sessão' }), { key: 'Home' });

    expect(valueOf('Valor total da reserva:')).toBe('R$ 97,00');
    expect(normalize(screen.getByText(/1\.0h ×/).textContent)).toBe('1.0h × R$ 97,00/h');
  });

  it('exposes the slider as 1 to 6 hours in 0.5 steps and the CTA linking to /reservar', () => {
    renderSection();
    const slider = screen.getByRole('slider', { name: 'Duração da sessão' });

    expect(slider).toHaveAttribute('aria-valuemin', '1');
    expect(slider).toHaveAttribute('aria-valuemax', '6');
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    expect(slider).toHaveAttribute('aria-valuenow', '1.5');
    expect(screen.getByText('1,5 Horas')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /Continuar para agendamento da sala/ }),
    ).toHaveAttribute('href', '/reservar');
    expect(
      screen.getByText('Inclui +30 min gratuitos de limpeza pós-atendimento'),
    ).toBeInTheDocument();
  });

  it('prices with the live catalog: 2 h on a weekday at R$ 90,00/h shows R$ 180,00 (NUC-181)', async () => {
    useCatalogWithTwoHourRate(9000);
    renderSection();

    await waitFor(() => expect(valueOf('Valor total da reserva:')).toBe('R$ 180,00'));
    expect(valueOf(/Sinal 50% no checkout/)).toBe('R$ 90,00');
    expect(normalize(screen.getByText(/Tarifa Desconto/).textContent)).toBe(
      '2.0h × R$ 90,00/h (Tarifa Desconto)',
    );
  });

  it('explains when the live categories cannot price the session', async () => {
    server.use(
      http.get('*/api/public/catalog', () =>
        HttpResponse.json({
          ...catalog,
          hourly: catalog.hourly.filter((c) => c.startMinute >= 1140),
        }),
      ),
    );
    renderSection();

    expect(await screen.findByText(/Não foi possível simular esta duração/)).toBeInTheDocument();
    expect(screen.queryByText('Valor total da reserva:')).toBeNull();
  });
});
