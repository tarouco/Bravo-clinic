import { lt } from 'drizzle-orm';
import { jobRuns } from '../db/schema';
import { materializeRecurrences } from '../modules/calendar/blocks.service';
import type { Job } from './runner';

const JOB_RUN_RETENTION_DAYS = 30;

/**
 * Daily (NUC-57, NUC-200): extends every recurring block rule to the booking horizon and deletes
 * the `job_runs` rows older than 30 days.
 */
export const materializeBlocks: Job = async (deps, now) => {
  const { created, skipped } = await materializeRecurrences(deps.db, now);
  const cutoff = new Date(now.getTime() - JOB_RUN_RETENTION_DAYS * 24 * 3_600_000);
  const purged = await deps.db
    .delete(jobRuns)
    .where(lt(jobRuns.startedAt, cutoff))
    .returning({ id: jobRuns.id });
  return { blocksCreated: created, blocksSkipped: skipped, purgedJobRuns: purged.length };
};
