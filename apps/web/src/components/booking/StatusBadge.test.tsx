import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { BookingStatus } from '@bravo/core';
import { PriceTag } from './PriceTag';
import { StatusBadge } from './StatusBadge';

// Labels of NUC-02, spelled out so a change in core labels is noticed here.
const LABELS: [BookingStatus, string][] = [
  ['awaiting_payment', 'Aguardando pgto'],
  ['pre_reserved', 'Pré-reserva'],
  ['held_for_renewal', 'Pré-reservada (renovação)'],
  ['confirmed', 'Confirmada'],
  ['paid', 'Quitada'],
  ['completed', 'Concluída'],
  ['no_show', 'No-show'],
  ['expired', 'Expirada'],
  ['cancelled_by_tenant', 'Cancelada pelo locatário'],
  ['cancelled_nonpayment', 'Cancelada por falta de pagamento'],
  ['cancelled_by_clinic', 'Cancelada pela clínica'],
];

describe('StatusBadge', () => {
  it.each(LABELS)('%s shows the label "%s"', (status, label) => {
    render(<StatusBadge status={status} />);

    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('uses the emerald fill for confirmed and the danger fill for cancelled by the clinic', () => {
    render(
      <>
        <StatusBadge status="confirmed" />
        <StatusBadge status="cancelled_by_clinic" />
      </>,
    );

    expect(screen.getByText('Confirmada')).toHaveClass('bg-emerald');
    expect(screen.getByText('Cancelada pela clínica')).toHaveClass('bg-danger-soft');
  });

  it('shows the payment status beside the status, except for "none"', () => {
    const { rerender } = render(
      <StatusBadge
        status="confirmed"
        paymentStatus={{ code: 'deposit_paid', label: 'Sinal pago · saldo pendente' }}
      />,
    );
    expect(screen.getByText('Sinal pago · saldo pendente')).toBeInTheDocument();

    rerender(<StatusBadge status="expired" paymentStatus={{ code: 'none', label: '—' }} />);
    expect(screen.queryByText('—')).toBeNull();
  });
});

describe('PriceTag', () => {
  it('formats cents in BRL with the unit suffix', () => {
    render(<PriceTag cents={8000} unit="/h" />);

    expect((screen.getByText(/R\$/).textContent ?? '').replace(/\u00a0/g, ' ')).toBe('R$ 80,00/h');
  });
});
