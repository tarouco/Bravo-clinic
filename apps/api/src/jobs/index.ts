import { chargeBalances } from './charge-balances';
import { expireHolds } from './expire-holds';
import { expirePurchases } from './expire-purchases';
import { holidayReminder, importHolidays } from './holidays';
import { emailRetry, retention } from './maintenance';
import { materializeBlocks } from './materialize-blocks';
import { noShows } from './no-shows';
import { periodRollover } from './period-rollover';
import { reconcilePayments } from './reconcile-payments';
import { recurringExpenses } from './recurring-expenses';
import { reminders } from './reminders';
import { renewals } from './renewals';
import { registerJob } from './runner';
import { suspensions } from './suspensions';

// The núcleo jobs (NUC-199). `routes/jobs.ts` serves whatever is registered here or by receita
// and gestao through `registerJob`.
registerJob('expire-holds', expireHolds);
registerJob('charge-balances', chargeBalances);
registerJob('reminders', reminders);
registerJob('no-shows', noShows);
registerJob('reconcile-payments', reconcilePayments);
registerJob('materialize-blocks', materializeBlocks);

// receita (design.md "Jobs"): daily at 03:00 BRT, and the 5-minute purchase-hold expiry.
registerJob('renewals', renewals);
registerJob('period-rollover', periodRollover);
registerJob('suspensions', suspensions);
registerJob('expire-purchases', expirePurchases);

// gestao (design.md "Privacy (LGPD) and maintenance jobs"): e-mail retry every 5 minutes,
// retention weekly. Their triggers are added to neon.ts by gestao T49.
registerJob('email-retry', emailRetry);
registerJob('retention', retention);
// Daily `0 9 * * *` UTC (GES-14); trigger added to neon.ts by T49.
registerJob('recurring-expenses', recurringExpenses);
// Daily `0 11 * * *` and weekly `0 7 * * 1` UTC (GES-130, GES-131); triggers added by T49.
registerJob('holiday-reminder', holidayReminder);
registerJob('import-holidays', importHolidays);

export { getJob, registerJob, registeredJobs, runJob, JOB_CONTEXT } from './runner';
export type { Job, JobDeps, JobStats } from './runner';
