import { percentOfCents, type Cents } from '../money';

export interface PaymentPolicy {
  depositPercent: number;
  balanceChargeHoursBefore: number;
  balanceDeadlineHoursBefore: number;
  fullUpfrontThresholdHours: number;
}

export interface PaymentSplit {
  mode: 'deposit_balance' | 'full_upfront';
  depositCents: Cents;
  balanceCents: Cents;
  payNowCents: Cents;
  creditUsedCents: Cents;
  balanceChargeAt: Date | null;
  balanceDueAt: Date | null;
}

const MS_PER_HOUR = 3_600_000;

/**
 * Sinal and saldo of a booking (PRD 5.4, architecture 7.6). Bookings starting less than
 * `fullUpfrontThresholdHours` ahead pay everything now. Credits pay the deposit first; leftover
 * credit reduces the balance.
 */
export function splitPayment(args: {
  netCents: Cents;
  creditCents: Cents;
  startsAt: Date;
  now: Date;
  policy: PaymentPolicy;
}): PaymentSplit {
  const { netCents, startsAt, now, policy } = args;
  const leadMs = startsAt.getTime() - now.getTime();
  const fullUpfront = leadMs < policy.fullUpfrontThresholdHours * MS_PER_HOUR;
  const depositCents = fullUpfront ? netCents : percentOfCents(netCents, policy.depositPercent);
  const creditUsedCents = Math.min(Math.max(args.creditCents, 0), netCents);
  const creditOnDeposit = Math.min(creditUsedCents, depositCents);
  const at = (hoursBefore: number) => new Date(startsAt.getTime() - hoursBefore * MS_PER_HOUR);
  return {
    mode: fullUpfront ? 'full_upfront' : 'deposit_balance',
    depositCents,
    balanceCents: netCents - depositCents - (creditUsedCents - creditOnDeposit),
    payNowCents: depositCents - creditOnDeposit,
    creditUsedCents,
    balanceChargeAt: fullUpfront ? null : at(policy.balanceChargeHoursBefore),
    balanceDueAt: fullUpfront ? null : at(policy.balanceDeadlineHoursBefore),
  };
}
