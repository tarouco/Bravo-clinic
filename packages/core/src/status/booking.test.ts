import { describe, expect, it } from 'vitest';
import {
  assertTransition,
  BOOKING_STATUSES,
  canTransition,
  InvalidTransitionError,
  paymentStatusOf,
  type BookingStatus,
  type PaymentStatusInput,
} from './booking';
import { bookingStatusLabel } from '../labels';

// docs/architecture.md section 3.1, written out literally, plus AD-032 (NUC-01).
const ALLOWED = new Set<string>([
  'awaiting_payment>confirmed',
  'awaiting_payment>paid',
  'awaiting_payment>expired',
  'awaiting_payment>cancelled_by_tenant',
  'pre_reserved>confirmed',
  'pre_reserved>paid',
  'pre_reserved>expired',
  'pre_reserved>cancelled_by_clinic',
  'held_for_renewal>confirmed',
  'held_for_renewal>cancelled_by_clinic',
  'held_for_renewal>expired',
  'confirmed>paid',
  'confirmed>completed',
  'confirmed>no_show',
  'confirmed>cancelled_by_tenant',
  'confirmed>cancelled_nonpayment',
  'confirmed>cancelled_by_clinic',
  'paid>completed',
  'paid>no_show',
  'paid>cancelled_by_tenant',
  'paid>cancelled_by_clinic',
  // AD-032
  'expired>confirmed',
  'expired>paid',
  'paid>confirmed',
]);

describe('canTransition (NUC-01)', () => {
  const pairs = BOOKING_STATUSES.flatMap((from) =>
    BOOKING_STATUSES.map((to) => [from, to] as const),
  );

  it('covers all 121 (from, to) pairs of the 11 statuses', () => {
    expect(BOOKING_STATUSES).toHaveLength(11);
    expect(pairs).toHaveLength(121);
  });

  it.each(pairs)('%s -> %s follows the transition table', (from, to) => {
    expect(canTransition(from, to)).toBe(ALLOWED.has(`${from}>${to}`));
  });

  it('assertTransition throws InvalidTransitionError only for forbidden pairs', () => {
    expect(() => assertTransition('awaiting_payment', 'confirmed')).not.toThrow();
    expect(() => assertTransition('completed', 'confirmed')).toThrow(InvalidTransitionError);
    expect(() => assertTransition('cancelled_by_tenant', 'paid')).toThrow(
      'Invalid booking transition cancelled_by_tenant -> paid',
    );
  });
});

describe('bookingStatusLabel (NUC-02)', () => {
  const expected: Record<BookingStatus, string> = {
    awaiting_payment: 'Aguardando pgto',
    pre_reserved: 'Pré-reserva',
    held_for_renewal: 'Pré-reservada (renovação)',
    confirmed: 'Confirmada',
    paid: 'Quitada',
    completed: 'Concluída',
    no_show: 'No-show',
    expired: 'Expirada',
    cancelled_by_tenant: 'Cancelada pelo locatário',
    cancelled_nonpayment: 'Cancelada por falta de pagamento',
    cancelled_by_clinic: 'Cancelada pela clínica',
  };

  it.each(BOOKING_STATUSES)('labels %s in pt-BR', (status) => {
    expect(bookingStatusLabel[status]).toBe(expected[status]);
  });
});

describe('paymentStatusOf (NUC-03)', () => {
  const base: PaymentStatusInput = {
    status: 'confirmed',
    paymentMode: 'deposit_balance',
    balanceCents: 8000,
    refundedCents: 0,
  };
  const cases: [string, Partial<PaymentStatusInput>, string, string][] = [
    ['awaiting_payment', { status: 'awaiting_payment' }, 'awaiting', 'Aguardando pagamento'],
    [
      'pre_reserved with no balance (full upfront)',
      { status: 'pre_reserved', paymentMode: 'full_upfront', balanceCents: 0 },
      'awaiting',
      'Aguardando pagamento',
    ],
    ['confirmed deposit with balance', {}, 'deposit_paid', 'Sinal pago · saldo pendente'],
    [
      'manual with balance',
      { paymentMode: 'manual' },
      'manual_pending',
      'Confirmada manualmente · pagamento pendente',
    ],
    ['paid status', { status: 'paid', balanceCents: 0 }, 'paid', 'Quitada'],
    ['confirmed with balance 0', { balanceCents: 0 }, 'paid', 'Quitada'],
    ['manual with balance 0', { paymentMode: 'manual', balanceCents: 0 }, 'paid', 'Quitada'],
    ['package mode', { paymentMode: 'package', balanceCents: 0 }, 'package', 'Pago com pacote'],
    [
      'subscription occurrence held for renewal',
      { status: 'held_for_renewal', paymentMode: 'subscription', balanceCents: 0 },
      'package',
      'Pago com pacote',
    ],
    [
      'cancelled with approved refunds',
      { status: 'cancelled_by_tenant', refundedCents: 8000 },
      'refunded',
      'Reembolsada',
    ],
    [
      'cancelled by clinic with refunds',
      { status: 'cancelled_by_clinic', balanceCents: 0, refundedCents: 16000 },
      'refunded',
      'Reembolsada',
    ],
    ['cancelled without refunds', { status: 'cancelled_nonpayment' }, 'none', '—'],
    ['expired', { status: 'expired', balanceCents: 0 }, 'none', '—'],
    ['full upfront confirmed with balance', { paymentMode: 'full_upfront' }, 'none', '—'],
  ];

  it.each(cases)('%s', (_name, patch, code, label) => {
    expect(paymentStatusOf({ ...base, ...patch })).toEqual({ code, label });
  });
});
