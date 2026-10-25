import type { Cents } from '../money';

export interface ReschedulePolicy {
  freeCount: number;
  minHoursBefore: number;
  windowDays: number;
}

export type RescheduleRefusal = 'too_late' | 'limit_reached' | 'beyond_window';

const MS_PER_HOUR = 3_600_000;

/** Self-service reschedule eligibility (PRD 5.5); a staff exception bypasses every rule. */
export function evaluateReschedule(args: {
  startsAt: Date;
  newStartsAt: Date;
  now: Date;
  rescheduleCount: number;
  isStaffException: boolean;
  policy: ReschedulePolicy;
}): { allowed: true } | { allowed: false; reason: RescheduleRefusal } {
  if (args.isStaffException) return { allowed: true };
  const { policy, now } = args;
  if (args.startsAt.getTime() - now.getTime() < policy.minHoursBefore * MS_PER_HOUR) {
    return { allowed: false, reason: 'too_late' };
  }
  if (args.rescheduleCount >= policy.freeCount) return { allowed: false, reason: 'limit_reached' };
  if (args.newStartsAt.getTime() > now.getTime() + policy.windowDays * 24 * MS_PER_HOUR) {
    return { allowed: false, reason: 'beyond_window' };
  }
  return { allowed: true };
}

/** A more expensive slot pays the difference; a cheaper one turns it into credit. */
export function rescheduleDifference(
  oldNetCents: Cents,
  newNetCents: Cents,
): { payCents: Cents; creditCents: Cents } {
  return {
    payCents: Math.max(0, newNetCents - oldNetCents),
    creditCents: Math.max(0, oldNetCents - newNetCents),
  };
}

export interface RescheduleSettlement {
  payNowCents: Cents;
  creditCents: Cents;
  newTotalCents: Cents;
  newPaidCents: Cents;
  newBalanceCents: Cents;
  newDepositCents: Cents;
}

/**
 * Money after a reschedule (spec W-ST). A cheaper slot first lowers the unpaid balance; only money
 * already paid above the new total becomes credit. The deposit is kept, capped at the new total.
 */
export function settleReschedule(args: {
  oldNetCents: Cents;
  newNetCents: Cents;
  paidCents: Cents;
  depositCents: Cents;
}): RescheduleSettlement {
  const { oldNetCents, newNetCents, paidCents, depositCents } = args;
  const payNowCents = Math.max(0, newNetCents - oldNetCents);
  const creditCents = payNowCents > 0 ? 0 : Math.max(0, paidCents - newNetCents);
  const newPaidCents = paidCents + payNowCents - creditCents;
  return {
    payNowCents,
    creditCents,
    newTotalCents: newNetCents,
    newPaidCents,
    newBalanceCents: newNetCents - newPaidCents,
    newDepositCents: Math.min(depositCents, newNetCents),
  };
}
