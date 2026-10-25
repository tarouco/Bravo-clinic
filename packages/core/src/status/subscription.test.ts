import { describe, expect, it } from 'vitest';
import {
  assertSubscriptionTransition,
  canTransitionPeriod,
  canTransitionSubscription,
  PERIOD_STATUSES,
  SUBSCRIPTION_STATUSES,
  type SubscriptionStatus,
} from './subscription';
import { InvalidTransitionError } from './booking';
import {
  couponUseStatusLabel,
  creditSourceLabel,
  extraLotSourceLabel,
  ledgerEntryLabel,
  subscriptionStatusLabel,
} from '../labels';

// REC-60, written out literally.
const SUBSCRIPTION_ALLOWED = new Set<string>([
  'awaiting_payment>active',
  'awaiting_payment>expired',
  'active>active',
  'active>suspended',
  'active>cancelled',
  'active>switched',
  'suspended>active',
  'suspended>ended',
  'suspended>cancelled',
]);

// REC-61, written out literally.
const PERIOD_ALLOWED = new Set<string>([
  'upcoming>awaiting_payment',
  'upcoming>cancelled',
  'awaiting_payment>paid',
  'awaiting_payment>active',
  'awaiting_payment>failed',
  'awaiting_payment>cancelled',
  'paid>active',
  'paid>cancelled',
  'active>closed',
]);

describe('canTransitionSubscription (REC-60)', () => {
  const pairs = SUBSCRIPTION_STATUSES.flatMap((from) =>
    SUBSCRIPTION_STATUSES.map((to) => [from, to] as const),
  );

  it('covers all 49 pairs of the 7 statuses', () => {
    expect(SUBSCRIPTION_STATUSES).toHaveLength(7);
    expect(pairs).toHaveLength(49);
  });

  it.each(pairs)('%s -> %s follows REC-60', (from, to) => {
    expect(canTransitionSubscription(from, to)).toBe(SUBSCRIPTION_ALLOWED.has(`${from}>${to}`));
  });

  it.each([
    ['ended', 'active'],
    ['expired', 'active'],
    ['cancelled', 'active'],
    ['switched', 'active'],
    ['awaiting_payment', 'suspended'],
  ] as const)('forbids %s -> %s', (from, to) => {
    expect(canTransitionSubscription(from, to)).toBe(false);
  });
});

describe('canTransitionPeriod (REC-61)', () => {
  const pairs = PERIOD_STATUSES.flatMap((from) => PERIOD_STATUSES.map((to) => [from, to] as const));

  it('covers all 49 pairs of the 7 statuses', () => {
    expect(PERIOD_STATUSES).toHaveLength(7);
    expect(pairs).toHaveLength(49);
  });

  it.each(pairs)('%s -> %s follows REC-61', (from, to) => {
    expect(canTransitionPeriod(from, to)).toBe(PERIOD_ALLOWED.has(`${from}>${to}`));
  });

  it.each([
    ['closed', 'active'],
    ['cancelled', 'paid'],
    ['failed', 'paid'],
    ['active', 'paid'],
  ] as const)('forbids %s -> %s', (from, to) => {
    expect(canTransitionPeriod(from, to)).toBe(false);
  });
});

describe('assertSubscriptionTransition (REC-60)', () => {
  it('throws InvalidTransitionError for ended -> active', () => {
    expect(() => assertSubscriptionTransition('ended', 'active')).toThrow(InvalidTransitionError);
    expect(() => assertSubscriptionTransition('ended', 'active')).toThrow(
      'Invalid subscription transition ended -> active',
    );
  });

  it('carries from and to on the error', () => {
    try {
      assertSubscriptionTransition('expired', 'active');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidTransitionError);
      expect((error as InvalidTransitionError<SubscriptionStatus>).from).toBe('expired');
      expect((error as InvalidTransitionError<SubscriptionStatus>).to).toBe('active');
    }
  });

  it('does not throw for an allowed transition', () => {
    expect(() => assertSubscriptionTransition('awaiting_payment', 'active')).not.toThrow();
    expect(() => assertSubscriptionTransition('suspended', 'active')).not.toThrow();
  });
});

describe('receita labels (REC-42, REC-148)', () => {
  it.each([
    ['awaiting_payment', 'Aguardando pgto'],
    ['active', 'Ativa'],
    ['suspended', 'Suspensa'],
    ['ended', 'Encerrada'],
    ['cancelled', 'Cancelada'],
    ['switched', 'Trocada'],
    ['expired', 'Expirada'],
  ] as const)('labels subscription status %s as %s', (status, label) => {
    expect(subscriptionStatusLabel[status]).toBe(label);
  });

  it('labels period_grant of seq 1 "Compra" and of seq > 1 "Renovação"', () => {
    expect(ledgerEntryLabel('period_grant', 1)).toBe('Compra');
    expect(ledgerEntryLabel('period_grant', 2)).toBe('Renovação');
    expect(ledgerEntryLabel('period_grant', 7)).toBe('Renovação');
  });

  it.each([
    ['debit', 'Reserva'],
    ['refund', 'Estorno'],
    ['expiry', 'Expiração'],
    ['conversion_in', 'Saldo convertido'],
    ['conversion_out', 'Saldo transferido'],
    ['manual_adjustment', 'Ajuste manual'],
  ] as const)('labels ledger entry %s as %s', (entryType, label) => {
    expect(ledgerEntryLabel(entryType, 3)).toBe(label);
  });

  it('labels extra lots by source', () => {
    expect(extraLotSourceLabel).toEqual({
      purchase: 'Horas extras compradas',
      closed_day_compensation: 'Compensação de dia fechado',
      manual: 'Ajuste',
    });
  });

  it('labels credit sources', () => {
    expect(creditSourceLabel).toEqual({
      reschedule_difference: 'Diferença de reagendamento',
      closed_day_compensation: 'Compensação de dia fechado',
      manual: 'Crédito manual',
      clinic_cancellation: 'Cancelamento pela clínica',
    });
  });

  it('labels coupon-use statuses', () => {
    expect(couponUseStatusLabel).toEqual({
      reserved: 'Reservado',
      consumed: 'Usado',
      released: 'Liberado',
    });
  });
});
