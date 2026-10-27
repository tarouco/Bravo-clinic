import { utcToLocal, type LocalDate } from '@bravo/core';
import { eq } from 'drizzle-orm';
import type { Tx } from '../../db/client';
import { subscriptionPeriods } from '../../db/schema';
import type { ChargeEffects } from '../../extensions/registry';
import type { RequestContext } from '../../lib/audit';
import { grantPeriod } from '../packages/minutes.service';
import { transitionPeriod, type PeriodRow } from './transitions';

// Period lifecycle (REC-16, REC-53, REC-61): activation grants the included minutes once.

export interface PeriodOptions {
  now: Date;
  appBaseUrl: string;
  fx: ChargeEffects;
}

/** The clinic's local date of `now`. */
export const todayOf = (now: Date): LocalDate => utcToLocal(now).date;

/**
 * `paid | awaiting_payment → active` with `paid_at`; an hour-package period gets its
 * `period_grant` of the included minutes in the same transaction (the guarded transition makes a
 * second activation fail instead of granting twice).
 */
export async function activatePeriod(
  tx: Tx,
  ctx: RequestContext,
  periodId: string,
  opts: PeriodOptions,
): Promise<PeriodRow> {
  const { now } = opts;
  const [current] = await tx
    .select({ paidAt: subscriptionPeriods.paidAt })
    .from(subscriptionPeriods)
    .where(eq(subscriptionPeriods.id, periodId))
    .for('update');
  let period = await transitionPeriod(tx, periodId, ['paid', 'awaiting_payment'], 'active', now, {
    paidAt: current?.paidAt ?? now,
  });
  if (period.includedMinutes !== null && period.includedMinutes > 0) {
    period = await grantPeriod(tx, ctx, {
      periodId: period.id,
      minutes: period.includedMinutes,
      now,
    });
  }
  return period;
}
