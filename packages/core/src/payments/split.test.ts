import { describe, expect, it } from 'vitest';
import { splitPayment, type PaymentPolicy } from './split';

// Spec W-SP: factory policy, now = 2026-10-20T12:00:00Z.
const NOW = new Date('2026-10-20T12:00:00Z');
const HOUR = 3_600_000;
const FACTORY: PaymentPolicy = {
  depositPercent: 50,
  balanceChargeHoursBefore: 48,
  balanceDeadlineHoursBefore: 24,
  fullUpfrontThresholdHours: 48,
};
const ahead = (ms: number) => new Date(NOW.getTime() + ms);
const FIVE_DAYS = ahead(5 * 24 * HOUR);

const split = (netCents: number, creditCents: number, startsAt: Date) =>
  splitPayment({ netCents, creditCents, startsAt, now: NOW, policy: FACTORY });

const depositSchedule = (startsAt: Date) => ({
  balanceChargeAt: new Date(startsAt.getTime() - 48 * HOUR),
  balanceDueAt: new Date(startsAt.getTime() - 24 * HOUR),
});

describe('splitPayment with W-SP (NUC-25)', () => {
  it('SP-1: net 21900, 5 days ahead -> deposit 10950, balance 10950, pay now 10950', () => {
    expect(split(21900, 0, FIVE_DAYS)).toEqual({
      mode: 'deposit_balance',
      depositCents: 10950,
      balanceCents: 10950,
      payNowCents: 10950,
      creditUsedCents: 0,
      ...depositSchedule(FIVE_DAYS),
    });
  });

  it('SP-2: net 9701 rounds the deposit half up to 4851, balance 4850', () => {
    expect(split(9701, 0, FIVE_DAYS)).toEqual({
      mode: 'deposit_balance',
      depositCents: 4851,
      balanceCents: 4850,
      payNowCents: 4851,
      creditUsedCents: 0,
      ...depositSchedule(FIVE_DAYS),
    });
  });

  it('SP-3: 47h59m ahead pays everything now (full_upfront, no schedule)', () => {
    expect(split(21900, 0, ahead(47 * HOUR + 59 * 60_000))).toEqual({
      mode: 'full_upfront',
      depositCents: 21900,
      balanceCents: 0,
      payNowCents: 21900,
      creditUsedCents: 0,
      balanceChargeAt: null,
      balanceDueAt: null,
    });
  });

  it('SP-4: exactly 48h00m ahead is still deposit_balance', () => {
    const startsAt = ahead(48 * HOUR);
    expect(split(21900, 0, startsAt)).toEqual({
      mode: 'deposit_balance',
      depositCents: 10950,
      balanceCents: 10950,
      payNowCents: 10950,
      creditUsedCents: 0,
      ...depositSchedule(startsAt),
    });
    expect(split(21900, 0, startsAt).balanceChargeAt).toEqual(NOW);
  });

  it('SP-5: credit 12000 covers the deposit and lowers the balance to 8000', () => {
    expect(split(20000, 12000, FIVE_DAYS)).toEqual({
      mode: 'deposit_balance',
      depositCents: 10000,
      balanceCents: 8000,
      payNowCents: 0,
      creditUsedCents: 12000,
      ...depositSchedule(FIVE_DAYS),
    });
  });

  it('SP-6: credit 4000 pays part of the deposit, pay now 6000', () => {
    expect(split(20000, 4000, FIVE_DAYS)).toEqual({
      mode: 'deposit_balance',
      depositCents: 10000,
      balanceCents: 10000,
      payNowCents: 6000,
      creditUsedCents: 4000,
      ...depositSchedule(FIVE_DAYS),
    });
  });

  it('uses the configured charge and deadline hours for the schedule', () => {
    const policy = { ...FACTORY, balanceChargeHoursBefore: 72, balanceDeadlineHoursBefore: 36 };
    const result = splitPayment({
      netCents: 21900,
      creditCents: 0,
      startsAt: FIVE_DAYS,
      now: NOW,
      policy,
    });
    expect(result.balanceChargeAt).toEqual(new Date(FIVE_DAYS.getTime() - 72 * HOUR));
    expect(result.balanceDueAt).toEqual(new Date(FIVE_DAYS.getTime() - 36 * HOUR));
  });
});
