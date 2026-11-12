import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { policies } from '../../../test/fixtures/nucleo';
import { server } from '../../../test/msw/server';
import { renderWithProviders, stubClinicConfig } from '../../../test/render-with-providers';
import { AmenitiesSection, LaunchCtaSection, PoliciesSection } from './HomeStaticSections';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AmenitiesSection', () => {
  it('shows the heading, four cards and the address and reschedule from the API', async () => {
    const { container } = renderWithProviders(<AmenitiesSection />);

    expect(
      screen.getByRole('heading', {
        level: 2,
        name: 'Estrutura completa para você focar no atendimento.',
      }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText('Dom Bosco, Itajaí - SC, com fácil estacionamento.'),
    ).toBeInTheDocument();
    expect(await screen.findByText('1 reagendamento grátis')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 4 })).toHaveLength(4);
    expect(container.textContent).not.toMatch(/Rua XXX|manobrista/);
  });
});

describe('PoliciesSection', () => {
  it('shows the heading and the three policies with the configured values', async () => {
    renderWithProviders(<PoliciesSection />);

    expect(
      screen.getByRole('heading', {
        level: 2,
        name: 'Políticas de reserva, sinal e cancelamento',
      }),
    ).toBeInTheDocument();
    expect(await screen.findByText('Sinal de 50%')).toBeInTheDocument();
    expect(screen.getByText('Saldo 48h antes')).toBeInTheDocument();
    expect(screen.getByText('Reagendamento cortesia')).toBeInTheDocument();
  });

  it('states that the sinal is not refundable and drops the reference refund promise', async () => {
    const { container } = renderWithProviders(<PoliciesSection />);
    await screen.findByText('Sinal de 50%');
    const text = (container.textContent ?? '').replace(/\s+/g, ' ');

    expect(text).toContain('não é reembolsável');
    expect(text).not.toContain('é reembolsável em casos de desistência');
    expect(text).not.toContain('7 dias antes');
  });
});

describe('PoliciesSection with values edited in the admin', () => {
  it('shows the new deposit, balance and reschedule numbers', async () => {
    server.use(
      http.get('*/api/public/policies', () =>
        HttpResponse.json({
          ...policies,
          values: {
            ...policies.values,
            'payment.deposit_percent': 30,
            'payment.balance_charge_hours_before': 72,
            'payment.balance_deadline_hours_before': 36,
            'policy.reschedule_free_count': 2,
            'policy.reschedule_min_hours_before': 12,
          },
        }),
      ),
    );
    const { container } = renderWithProviders(<PoliciesSection />);

    expect(await screen.findByText('Sinal de 30%')).toBeInTheDocument();
    expect(screen.getByText('Saldo 72h antes')).toBeInTheDocument();
    const text = (container.textContent ?? '').replace(/\s+/g, ' ');
    expect(text).toContain('Os 70% restantes');
    expect(text).toContain('quitação é 36h antes');
    expect(text).toContain('2 reagendamentos cortesia self-service');
    expect(text).toContain('superior a 12 horas');
  });
});

describe('LaunchCtaSection', () => {
  it('shows the corrected pre-launch copy and the reserve CTA', () => {
    stubClinicConfig('');
    const { container } = renderWithProviders(<LaunchCtaSection />);

    expect(screen.getByText('Pré-lançamento exclusivo')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {
        level: 2,
        name: 'Pronto para elevar o padrão dos seus atendimentos?',
      }),
    ).toBeInTheDocument();
    expect(container.textContent).toContain('custos imobiliários no Dom Bosco');
    expect(container.textContent).not.toContain('Jardins');
    expect(screen.getByRole('link', { name: 'Reservar horário agora' })).toHaveAttribute(
      'href',
      '#simulador',
    );
  });

  it('links the WhatsApp CTA to the configured number', async () => {
    stubClinicConfig('+5547999990000');
    renderWithProviders(<LaunchCtaSection />);

    const link = screen.getByRole('link', { name: 'Tirar dúvidas com a recepção' });
    await waitFor(() => expect(link).toHaveAttribute('href', 'https://wa.me/5547999990000'));
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('falls back to the bare wa.me link when the number is unknown', async () => {
    stubClinicConfig(null);
    renderWithProviders(<LaunchCtaSection />);

    const link = screen.getByRole('link', { name: 'Tirar dúvidas com a recepção' });
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    expect(link).toHaveAttribute('href', 'https://wa.me/');
  });
});
