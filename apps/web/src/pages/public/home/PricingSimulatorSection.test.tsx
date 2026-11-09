import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { apiError } from '../../../test/msw/handlers';
import { catalog, policies } from '../../../test/fixtures/nucleo';
import { server } from '../../../test/msw/server';
import { renderWithProviders } from '../../../test/render-with-providers';
import { PricingSimulatorSection } from './PricingSimulatorSection';

/** Whitespace-normalized text; \s also turns the no-break space of formatBRL into a space. */
const normalize = (text: string | null) => (text ?? '').replace(/\s+/g, ' ').trim();

function renderSection() {
  return renderWithProviders(<PricingSimulatorSection />);
}

/** Waits for the live catalog and policies to render the simulator. */
async function renderLoaded() {
  const view = renderSection();
  await screen.findByText('Valor total da reserva:');
  return view;
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
  it('is the #simulador section and waits for the live tariffs', async () => {
    const { container } = renderSection();

    expect(container.querySelector('section')).toHaveAttribute('id', 'simulador');
    expect(screen.getByRole('status', { name: 'Carregando tarifas' })).toBeInTheDocument();
    await screen.findByText('Valor total da reserva:');
    expect(container.textContent).toContain('Reservando 2 horas ou mais, as tarifas têm desconto.');
  });

  it('builds the tariff table from the catalog categories and the business hours', async () => {
    const { container } = await renderLoaded();

    expect(screen.getByText('Dias úteis (07:00 às 19:00)')).toBeInTheDocument();
    expect(screen.getByText('Todos os dias (19:00 às 00:00)')).toBeInTheDocument();
    expect(screen.getByText('Sábados, domingos e feriados (09:00 às 19:00)')).toBeInTheDocument();
    expect(screen.getByText('Turno completo comercial (07:00–12:00)')).toBeInTheDocument();
    // The lowest hourly rate of the catalog is the one gold row.
    const gold = container.querySelectorAll('.bg-gold');
    expect(gold).toHaveLength(1);
    expect(normalize(gold[0]?.textContent ?? null)).toBe('2 horas ou maisR$ 80,00/h');
  });

  it('shows the cleanup guarantee with the configured minutes', async () => {
    server.use(
      http.get('*/api/public/catalog', () =>
        HttpResponse.json({ ...catalog, rules: { ...catalog.rules, cleanupMinutes: 45 } }),
      ),
    );
    await renderLoaded();

    expect(
      screen.getByRole('heading', {
        level: 4,
        name: 'Garantia de biossegurança: bloqueio de limpeza de 45 min',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Inclui +45 min gratuitos de limpeza pós-atendimento'),
    ).toBeInTheDocument();
  });

  it('defaults to a weekday at the discount length: total R$ 160,00, sinal and saldo 50%', async () => {
    await renderLoaded();

    expect(valueOf('Valor total da reserva:')).toBe('R$ 160,00');
    expect(valueOf(/Sinal 50% no checkout/)).toBe('R$ 80,00');
    expect(valueOf(/Saldo 50% restante \(cobrado 48h/)).toBe('R$ 80,00');
    expect(screen.getByText('2 Horas')).toBeInTheDocument();
    expect(normalize(screen.getByText(/2\.0h ×/).textContent)).toBe(
      '2.0h × R$ 80,00/h (2 horas ou mais)',
    );
    expect(screen.getByRole('button', { name: 'Dia útil' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('follows the deposit and balance timing set in the admin policies', async () => {
    server.use(
      http.get('*/api/public/policies', () =>
        HttpResponse.json({
          ...policies,
          values: {
            ...policies.values,
            'payment.deposit_percent': 30,
            'payment.balance_charge_hours_before': 72,
          },
        }),
      ),
    );
    await renderLoaded();

    expect(valueOf(/Sinal 30% no checkout/)).toBe('R$ 48,00');
    expect(valueOf(/Saldo 70% restante \(cobrado 72h/)).toBe('R$ 112,00');
  });

  it('switching to the weekend uses the weekend rates', async () => {
    await renderLoaded();

    await userEvent.click(screen.getByRole('button', { name: 'Fim de semana / feriado' }));

    expect(valueOf('Valor total da reserva:')).toBe('R$ 198,00');
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Duração da sessão' }), { key: 'Home' });
    expect(valueOf('Valor total da reserva:')).toBe('R$ 120,00');
    expect(screen.getByText('1 Hora')).toBeInTheDocument();
  });

  it('exposes the slider from the shortest category to 6 hours in slot steps', async () => {
    await renderLoaded();
    const slider = screen.getByRole('slider', { name: 'Duração da sessão' });

    expect(slider).toHaveAttribute('aria-valuemin', '1');
    expect(slider).toHaveAttribute('aria-valuemax', '6');
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    expect(slider).toHaveAttribute('aria-valuenow', '1.5');
    expect(screen.getByText('1h (mínimo)')).toBeInTheDocument();
    expect(screen.getByText('2h (faixa desconto)')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /Continuar para agendamento da sala/ }),
    ).toHaveAttribute('href', '/reservar');
  });

  it('prices with the live catalog: 2 h on a weekday at R$ 90,00/h shows R$ 180,00 (NUC-181)', async () => {
    useCatalogWithTwoHourRate(9000);
    renderSection();

    await waitFor(() => expect(valueOf('Valor total da reserva:')).toBe('R$ 180,00'));
    expect(valueOf(/Sinal 50% no checkout/)).toBe('R$ 90,00');
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

  it('shows no invented prices when the catalog cannot be loaded', async () => {
    server.use(http.get('*/api/public/catalog', () => apiError(500, 'INTERNAL', 'Erro.')));
    const { container } = renderSection();

    expect(await screen.findByText(/Não foi possível carregar as tarifas/)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/R\$/);
  });
});
