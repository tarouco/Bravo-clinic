import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { HeroSection } from './HeroSection';

function renderHero(overrides: Partial<Parameters<typeof HeroSection>[0]> = {}) {
  const onRoomChange = vi.fn();
  const onCheck = vi.fn();
  render(
    <HeroSection
      selectedRoom="principal"
      onRoomChange={onRoomChange}
      onCheck={onCheck}
      {...overrides}
    />,
  );
  return { onRoomChange, onCheck };
}

describe('HeroSection', () => {
  it('renders the h1, the corrected lead and the pill', () => {
    renderHero();

    expect(
      screen.getByRole('heading', { level: 1, name: 'Saúde, beleza e bem-estar em um só lugar.' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/estúdios clínicos na Praia Brava, em Itajaí/)).toBeInTheDocument();
    expect(screen.getByText('SALAS INTELIGENTES SOB DEMANDA')).toBeInTheDocument();
  });

  it('links the two CTAs to #simulador and #salas', () => {
    renderHero();

    expect(screen.getByRole('link', { name: /Simular e Reservar/ })).toHaveAttribute(
      'href',
      '#simulador',
    );
    expect(screen.getByRole('link', { name: 'Conhecer as Salas' })).toHaveAttribute(
      'href',
      '#salas',
    );
  });

  it('offers the corrected full-shift option and no 5h30 wording', () => {
    renderHero();

    expect(screen.getByRole('option', { name: 'Turno Completo (5h)' })).toBeInTheDocument();
    expect(screen.queryByText(/5h30/)).not.toBeInTheDocument();
  });

  it('reflects selectedRoom and reports a room change', async () => {
    const { onRoomChange } = renderHero({ selectedRoom: 'terceira' });
    const select = screen.getByLabelText('1. Selecionar Consultório');

    expect(select).toHaveValue('terceira');
    await userEvent.selectOptions(select, 'secundaria');

    expect(onRoomChange).toHaveBeenCalledTimes(1);
    expect(onRoomChange).toHaveBeenCalledWith('secundaria');
  });

  it('calls onCheck when "Verificar Horários" is clicked', async () => {
    const { onCheck } = renderHero();

    await userEvent.click(screen.getByRole('button', { name: 'Verificar Horários' }));

    expect(onCheck).toHaveBeenCalledTimes(1);
  });

  it('renders the date field and the three information badges', () => {
    renderHero();

    expect(screen.getByLabelText('2. Data do Atendimento')).toHaveAttribute('type', 'date');
    expect(screen.getByLabelText('3. Modalidade / Formato')).toBeInTheDocument();
    expect(
      screen.getByText('Sem fidelidade: pague apenas pelo tempo de uso reservado'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Bloqueio de limpeza de 30 min automático e sem custo após cada sessão'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Sinal de 50% seguro via Mercado Pago (Pix ou Cartão)'),
    ).toBeInTheDocument();
  });
});
