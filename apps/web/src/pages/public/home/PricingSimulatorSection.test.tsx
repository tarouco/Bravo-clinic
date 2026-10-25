import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { PricingSimulatorSection } from './PricingSimulatorSection';

const normalize = (text: string | null) => (text ?? '').replace(/\s+/g, ' ').trim();

function renderSection() {
  return render(
    <MemoryRouter>
      <PricingSimulatorSection />
    </MemoryRouter>,
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
        name: 'Garantia de Biossegurança: Bloqueio de Limpeza de 30 min',
      }),
    ).toBeInTheDocument();
  });

  it('defaults to Dia Útil Comercial, 2 hours: total R$ 160,00, sinal R$ 80,00, saldo R$ 80,00', () => {
    renderSection();

    expect(valueOf('Valor Total da Reserva:')).toBe('R$ 160,00');
    expect(valueOf(/Sinal 50% no checkout/)).toBe('R$ 80,00');
    expect(valueOf(/Saldo 50% restante/)).toBe('R$ 80,00');
    expect(screen.getByText('2 Horas')).toBeInTheDocument();
    expect(normalize(screen.getByText(/Tarifa Desconto/).textContent)).toBe(
      '2.0h × R$ 80,00/h (Tarifa Desconto)',
    );
    expect(screen.getByRole('button', { name: 'Dia Útil Comercial' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Noite / Fim de Semana' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('switching to Noite / Fim de Semana shows R$ 198,00 and flips aria-pressed', async () => {
    renderSection();

    await userEvent.click(screen.getByRole('button', { name: 'Noite / Fim de Semana' }));

    expect(valueOf('Valor Total da Reserva:')).toBe('R$ 198,00');
    expect(valueOf(/Sinal 50% no checkout/)).toBe('R$ 99,00');
    expect(screen.getByRole('button', { name: 'Noite / Fim de Semana' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Dia Útil Comercial' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('moving the range to 1 hour on Noite / Fim de Semana shows R$ 120,00', async () => {
    renderSection();
    await userEvent.click(screen.getByRole('button', { name: 'Noite / Fim de Semana' }));

    fireEvent.change(screen.getByLabelText('Duração da Sessão'), { target: { value: '1' } });

    expect(valueOf('Valor Total da Reserva:')).toBe('R$ 120,00');
    expect(screen.getByText('1 Hora')).toBeInTheDocument();
  });

  it('1 hour on Dia Útil Comercial shows R$ 97,00 and the plain formula', () => {
    renderSection();

    fireEvent.change(screen.getByLabelText('Duração da Sessão'), { target: { value: '1' } });

    expect(valueOf('Valor Total da Reserva:')).toBe('R$ 97,00');
    expect(normalize(screen.getByText(/1\.0h ×/).textContent)).toBe('1.0h × R$ 97,00/h');
  });

  it('exposes the range as 1 to 6 hours in 0.5 steps and the CTA linking to /reservar', () => {
    renderSection();
    const range = screen.getByLabelText('Duração da Sessão');

    expect(range).toHaveAttribute('min', '1');
    expect(range).toHaveAttribute('max', '6');
    expect(range).toHaveAttribute('step', '0.5');
    expect(
      screen.getByRole('link', { name: /Continuar para Agendamento da Sala/ }),
    ).toHaveAttribute('href', '/reservar');
    expect(
      screen.getByText('Inclui +30 min gratuitos de limpeza pós-atendimento'),
    ).toBeInTheDocument();
  });
});
