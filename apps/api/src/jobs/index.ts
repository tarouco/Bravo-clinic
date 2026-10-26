import { chargeBalances } from './charge-balances';
import { expireHolds } from './expire-holds';
import { materializeBlocks } from './materialize-blocks';
import { noShows } from './no-shows';
import { reconcilePayments } from './reconcile-payments';
import { reminders } from './reminders';
import { registerJob } from './runner';

// The núcleo jobs (NUC-199). `routes/jobs.ts` serves whatever is registered here or by receita
// and gestao through `registerJob`.
registerJob('expire-holds', expireHolds);
registerJob('charge-balances', chargeBalances);
registerJob('reminders', reminders);
registerJob('no-shows', noShows);
registerJob('reconcile-payments', reconcilePayments);
registerJob('materialize-blocks', materializeBlocks);

export { getJob, registerJob, registeredJobs, runJob, JOB_CONTEXT } from './runner';
export type { Job, JobDeps, JobStats } from './runner';
