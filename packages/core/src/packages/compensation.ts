import { mulDivRoundHalfUp, type Cents } from '../money';

// Closed-day compensation (docs/architecture.md section 7.10, PRD 5.2): the divisor is the period
// length in days.

export type PeriodDays = 30 | 60 | 90;

const PERIOD_DAYS: Record<'monthly' | 'bimonthly' | 'quarterly', PeriodDays> = {
  monthly: 30,
  bimonthly: 60,
  quarterly: 90,
};

export function periodDaysOf(period: 'monthly' | 'bimonthly' | 'quarterly'): PeriodDays {
  return PERIOD_DAYS[period];
}

/** Minutes per closed day of an hour package, half up: 1200 / 30 = 40 (REC-96). */
export function hourPackageCompensationMinutes(
  includedMinutes: number,
  periodDays: PeriodDays,
): number {
  return mulDivRoundHalfUp(includedMinutes, 1, periodDays);
}

/** Credit per closed day of a fixed schedule, half up: 616000 / 30 = 20533 (REC-96). */
export function fixedScheduleCompensationCents(
  periodPriceCents: Cents,
  periodDays: PeriodDays,
): Cents {
  return mulDivRoundHalfUp(periodPriceCents, 1, periodDays);
}
