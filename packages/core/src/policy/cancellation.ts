import type { Cents } from '../money';
import type { PaymentMode } from '../status/booking';

export type ClinicCancelOption = 'refund' | 'minutes' | 'credit';

export interface CancelPolicy {
  cancelRefundMinHoursBefore: number;
  packageCancelReturnMinHoursBefore: number;
  depositRefundable: boolean;
  /** `policy.clinic_cancel_options`, offered when the clinic cancels. */
  clinicCancelOptions: ClinicCancelOption[];
}

export interface CancellationResult {
  retainedCents: Cents;
  refundCents: Cents;
  minutesReturned: number;
  clinicOptions: ClinicCancelOption[];
}

const MS_PER_HOUR = 3_600_000;

/** Money and minutes kept and returned when a booking is cancelled (PRD 5.5, architecture 7.12). */
export function evaluateCancellation(args: {
  actor: 'tenant' | 'clinic';
  startsAt: Date;
  now: Date;
  kind: 'single' | 'fixed_occurrence';
  paymentMode: PaymentMode;
  depositCents: Cents;
  paidCents: Cents;
  packageMinutes: number;
  extraMinutes: number;
  withinCurrentPeriod: boolean;
  policy: CancelPolicy;
}): CancellationResult {
  const { policy, paidCents } = args;
  const debitedMinutes = args.packageMinutes + args.extraMinutes;

  if (args.actor === 'clinic') {
    return {
      retainedCents: 0,
      refundCents: paidCents,
      minutesReturned: debitedMinutes,
      clinicOptions: [...policy.clinicCancelOptions],
    };
  }

  const hoursBefore = (args.startsAt.getTime() - args.now.getTime()) / MS_PER_HOUR;
  const tenant = (retainedCents: Cents, minutesReturned: number): CancellationResult => ({
    retainedCents,
    refundCents: paidCents - retainedCents,
    minutesReturned,
    clinicOptions: [],
  });

  // A fixed-schedule occurrence is part of a closed-price subscription: nothing comes back.
  if (args.kind === 'fixed_occurrence' || args.paymentMode === 'subscription') {
    return tenant(paidCents, 0);
  }
  if (args.paymentMode === 'package') {
    const returns =
      hoursBefore >= policy.packageCancelReturnMinHoursBefore && args.withinCurrentPeriod;
    return tenant(paidCents, returns ? debitedMinutes : 0);
  }
  if (hoursBefore < policy.cancelRefundMinHoursBefore) return tenant(paidCents, 0);
  if (policy.depositRefundable) return tenant(0, 0);
  return tenant(Math.min(args.depositCents, paidCents), 0);
}
