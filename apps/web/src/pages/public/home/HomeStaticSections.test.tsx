import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, stubClinicConfig } from '../../../test/render-with-providers';
import { AmenitiesSection, LaunchCtaSection, PoliciesSection } from './HomeStaticSections';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AmenitiesSection', () => {
  it('shows the heading, four cards and the corrected address card', () => {
    const { container } = renderWithProviders(<AmenitiesSection />);

    expect(
      screen.getByRole('heading', {
        level: 2,
        name: 'Estrutura completa para você focar no atendimento.',
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 4 })).toHaveLength(4);
    expect(
      screen.getByText('Na Praia Brava, em Itajaí – SC, com fácil estacionamento.'),
    ).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/Rua XXX|manobrista/);
  });
});

describe('PoliciesSection', () => {
  it('shows the heading and the three policies', () => {
    renderWithProviders(<PoliciesSection />);

    expect(
      screen.getByRole('heading', {
        level: 2,
        name: 'Políticas de Reserva, Sinal e Cancelamento',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText('Sinal de 50%')).toBeInTheDocument();
    expect(screen.getByText('Saldo 48h Antes')).toBeInTheDocument();
    expect(screen.getByText('Reagendamento Cortesia')).toBeInTheDocument();
  });

  it('states that the sinal is not refundable and drops the reference refund promise', () => {
    const { container } = renderWithProviders(<PoliciesSection />);
    const text = (container.textContent ?? '').replace(/\s+/g, ' ');

    expect(text).toContain('não é reembolsável');
    expect(text).not.toContain('é reembolsável em casos de desistência');
    expect(text).not.toContain('7 dias antes');
  });
});

describe('LaunchCtaSection', () => {
  it('shows the corrected pre-launch copy and the reserve CTA', () => {
    stubClinicConfig('');
    const { container } = renderWithProviders(<LaunchCtaSection />);

    expect(screen.getByText('PRÉ-LANÇAMENTO EXCLUSIVO')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {
        level: 2,
        name: 'Pronto para elevar o padrão dos seus atendimentos?',
      }),
    ).toBeInTheDocument();
    expect(container.textContent).toContain('custos imobiliários na Praia Brava');
    expect(container.textContent).not.toContain('Jardins');
    expect(screen.getByRole('link', { name: 'Reservar Horário Agora' })).toHaveAttribute(
      'href',
      '#simulador',
    );
  });

  it('links the WhatsApp CTA to the configured number', async () => {
    stubClinicConfig('+5547999990000');
    renderWithProviders(<LaunchCtaSection />);

    const link = screen.getByRole('link', { name: 'Tirar Dúvidas com Recepção' });
    await waitFor(() => expect(link).toHaveAttribute('href', 'https://wa.me/5547999990000'));
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('falls back to the bare wa.me link when the number is unknown', async () => {
    stubClinicConfig(null);
    renderWithProviders(<LaunchCtaSection />);

    const link = screen.getByRole('link', { name: 'Tirar Dúvidas com Recepção' });
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    expect(link).toHaveAttribute('href', 'https://wa.me/');
  });
});
