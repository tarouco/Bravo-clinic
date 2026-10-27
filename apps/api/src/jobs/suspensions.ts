import { endAfterGrace, suspendDue } from '../modules/subscriptions/cancel.service';
import { JOB_CONTEXT, type Job } from './runner';

// Daily suspensions at 03:00 BRT (REC-54, REC-57): a renewal still unpaid on its `starts_on`
// suspends the subscription (held occurrences released); still unpaid at `starts_on +
// payment.renewal_grace_days` it ends. Guarded transitions make re-runs and the order relative to
// `period-rollover` irrelevant.

export const suspensions: Job = async (deps, now) => ({
  suspended: await suspendDue(deps, JOB_CONTEXT, now),
  ended: await endAfterGrace(deps, JOB_CONTEXT, now),
});
