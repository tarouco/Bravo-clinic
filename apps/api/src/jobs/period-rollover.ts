import { and, asc, eq, inArray, lte } from 'drizzle-orm';
import { subscriptionPeriods, subscriptions } from '../db/schema';
import { flushAfterCommit, newAfterCommit } from '../modules/booking/effects';
import { expireCredits } from '../modules/credits/credits.service';
import { expireLots } from '../modules/packages/minutes.service';
import { activatePeriod, closePeriod, todayOf } from '../modules/subscriptions/period.service';
import { JOB_CONTEXT, type Job } from './runner';

// Daily period rollover at 03:00 BRT (REC-17, REC-53, REC-67, REC-113): active periods that ended
// are closed (the minutes left expire), `paid` periods whose base date came are activated (grant,
// known closed days, next fixed hold), and expired extra lots and credit lots are zeroed. Every
// change is a guarded transition, so a re-run or a concurrent `suspensions` run changes nothing.

export const periodRollover: Job = async (deps, now) => {
  const today = todayOf(now);
  const ended = await deps.db
    .select({ id: subscriptionPeriods.id })
    .from(subscriptionPeriods)
    .where(and(eq(subscriptionPeriods.status, 'active'), lte(subscriptionPeriods.endsOn, today)))
    .orderBy(asc(subscriptionPeriods.id));
  let closed = 0;
  for (const { id } of ended) {
    const done = await deps.db.transaction(async (tx) => {
      const [current] = await tx
        .select({ status: subscriptionPeriods.status })
        .from(subscriptionPeriods)
        .where(eq(subscriptionPeriods.id, id))
        .for('update');
      if (current?.status !== 'active') return false;
      await closePeriod(tx, JOB_CONTEXT, id, now);
      return true;
    });
    if (done) closed += 1;
  }

  const starting = await deps.db
    .select({ id: subscriptionPeriods.id })
    .from(subscriptionPeriods)
    .innerJoin(subscriptions, eq(subscriptions.id, subscriptionPeriods.subscriptionId))
    .where(
      and(
        eq(subscriptionPeriods.status, 'paid'),
        lte(subscriptionPeriods.startsOn, today),
        inArray(subscriptions.status, ['active']),
      ),
    )
    .orderBy(asc(subscriptionPeriods.startsOn), asc(subscriptionPeriods.id));
  let activated = 0;
  for (const { id } of starting) {
    const fx = newAfterCommit();
    const done = await deps.db.transaction(async (tx) => {
      const [current] = await tx
        .select({ status: subscriptionPeriods.status })
        .from(subscriptionPeriods)
        .where(eq(subscriptionPeriods.id, id))
        .for('update');
      if (current?.status !== 'paid') return false;
      await activatePeriod(tx, JOB_CONTEXT, id, { now, appBaseUrl: deps.env.APP_BASE_URL, fx });
      return true;
    });
    await flushAfterCommit(deps, fx, JOB_CONTEXT);
    if (done) activated += 1;
  }

  const { lotsExpired, creditsExpired } = await deps.db.transaction(async (tx) => ({
    lotsExpired: await expireLots(tx, JOB_CONTEXT, now),
    creditsExpired: await expireCredits(tx, now),
  }));
  return { closed, activated, lotsExpired, creditsExpired };
};
