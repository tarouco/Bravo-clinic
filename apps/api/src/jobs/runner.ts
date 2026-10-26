import { and, eq, sql } from 'drizzle-orm';
import { jobRuns } from '../db/schema';
import type { RequestContext } from '../lib/audit';
import { logger } from '../lib/logger';
import type { PaymentDeps } from '../modules/payments/charges.service';

/** What a job needs: the payment services' dependencies (db, env, fetch, clock, registry). */
export type JobDeps = PaymentDeps;

export type JobStats = Record<string, number | boolean>;

/** A scheduled job: idempotent, safe to run twice, and given `now` so tests control the clock. */
export type Job = (deps: JobDeps, now: Date) => Promise<JobStats>;

/** Origin of every history row and audit entry a job writes. */
export const JOB_CONTEXT: RequestContext = {
  actorUserId: null,
  actorRole: null,
  origin: 'job',
  ip: null,
  requestId: null,
};

const jobs = new Map<string, Job>();

/** Registers a job under `/jobs/<name>`; receita and gestao add theirs the same way. */
export function registerJob(name: string, job: Job): void {
  jobs.set(name, job);
}

export const getJob = (name: string): Job | undefined => jobs.get(name);

export const registeredJobs = (): string[] => [...jobs.keys()];

const MAX_ERROR_LENGTH = 500;

/**
 * Runs `job` once at a time (NUC-195, NUC-196): a transaction-scoped advisory lock keyed by the
 * job name makes a second concurrent run return `{ skipped: true }` at once. The run is recorded
 * in `job_runs` (`running` while it works, then `ok` with its stats or `error` with the message);
 * an error is rethrown after it is recorded. The lock transaction does nothing else, so the job
 * itself uses the pool as usual.
 */
export async function runJob(
  name: string,
  job: Job,
  deps: JobDeps,
  invocationId: string | null = null,
): Promise<JobStats> {
  return deps.db.transaction(async (lockTx) => {
    const locked = await lockTx.execute<{ locked: boolean }>(
      sql`select pg_try_advisory_xact_lock(hashtext(${`job:${name}`})) as locked`,
    );
    const startedAt = deps.now();
    if (locked.rows[0]?.locked !== true) {
      await deps.db.insert(jobRuns).values({
        job: name,
        invocationId,
        startedAt,
        finishedAt: startedAt,
        status: 'ok',
        stats: { skipped: true },
      });
      return { skipped: true };
    }
    const [run] = await deps.db
      .insert(jobRuns)
      .values({ job: name, invocationId, startedAt, status: 'running' })
      .returning({ id: jobRuns.id });
    const finish = (values: Partial<typeof jobRuns.$inferInsert>) =>
      deps.db
        .update(jobRuns)
        .set({ finishedAt: new Date(), ...values })
        .where(and(eq(jobRuns.id, run?.id ?? -1), eq(jobRuns.status, 'running')));
    try {
      const stats = await job(deps, startedAt);
      await finish({ status: 'ok', stats });
      logger.info('job finished', { job: name, invocationId, stats });
      return stats;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await finish({ status: 'error', error: message.slice(0, MAX_ERROR_LENGTH) });
      logger.error('job failed', { job: name, invocationId, error: message });
      throw error;
    }
  });
}
