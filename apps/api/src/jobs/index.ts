import { expireHolds } from './expire-holds';
import { materializeBlocks } from './materialize-blocks';
import { registerJob } from './runner';

// The núcleo jobs (NUC-199). `routes/jobs.ts` serves whatever is registered here or by receita
// and gestao through `registerJob`.
registerJob('expire-holds', expireHolds);
registerJob('materialize-blocks', materializeBlocks);

export { getJob, registerJob, registeredJobs, runJob, JOB_CONTEXT } from './runner';
export type { Job, JobDeps, JobStats } from './runner';
