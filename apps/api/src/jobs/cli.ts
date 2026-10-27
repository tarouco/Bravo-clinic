import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertNotProduction } from '../../test/require-test-db';
import { createDb } from '../db/client';
import { parseEnv } from '../env';
import { buildRegistry } from '../extensions';
import { getJob, registeredJobs, runJob, type JobDeps, type JobStats } from './index';

// Dev/test runner of the scheduled jobs with an injected clock (design.md "Jobs"; used by e2e):
//   npm run job -w apps/api -- renewals --now=2026-11-30T06:00:00Z
// It runs against DATABASE_URL_TEST only and refuses NODE_ENV=production.

export interface CliArgs {
  name: string;
  now: Date;
}

/** `<job> [--now=<iso>]`; a missing `--now` means the current time. */
export function parseCliArgs(argv: string[], clock: () => Date = () => new Date()): CliArgs {
  const [name, ...rest] = argv.filter((a) => a !== '--');
  if (name === undefined || name.startsWith('--')) {
    throw new Error(`usage: job <name> [--now=<iso>]; jobs: ${registeredJobs().join(', ')}`);
  }
  const flag = rest.find((a) => a.startsWith('--now='));
  const now = flag === undefined ? clock() : new Date(flag.slice('--now='.length));
  if (Number.isNaN(now.getTime())) throw new Error(`invalid --now: ${flag ?? ''}`);
  return { name, now };
}

/** Runs one registered job through `runJob` (advisory lock, `job_runs`) at `--now`. */
export async function runCli(
  argv: string[],
  env: Record<string, string | undefined>,
  deps?: Omit<JobDeps, 'now'>,
): Promise<JobStats> {
  if (env['NODE_ENV'] === 'production') {
    throw new Error('jobs/cli.ts is for development and tests; refusing NODE_ENV=production');
  }
  const { name, now } = parseCliArgs(argv);
  const job = getJob(name);
  if (job === undefined) {
    throw new Error(`unknown job "${name}"; jobs: ${registeredJobs().join(', ')}`);
  }
  if (deps !== undefined)
    return runJob(name, job, { ...deps, now: () => now }, `cli:${randomUUID()}`);

  const url = env['DATABASE_URL_TEST'];
  if (url === undefined || url === '') throw new Error('DATABASE_URL_TEST is required');
  assertNotProduction(url, {
    urls: [env['DATABASE_URL'], env['DATABASE_URL_UNPOOLED']],
    branchId: env['NEON_BRANCH_PRODUCTION'],
  });
  const { pool, db } = createDb(url);
  try {
    return await runJob(
      name,
      job,
      {
        db,
        env: parseEnv({ ...env, DATABASE_URL: url }),
        fetch: globalThis.fetch,
        registry: buildRegistry(),
        now: () => now,
      },
      `cli:${randomUUID()}`,
    );
  } finally {
    await pool.end();
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const envFile = fileURLToPath(new URL('../../../../.env', import.meta.url));
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  try {
    const stats = await runCli(process.argv.slice(2), process.env);
    process.stdout.write(`${JSON.stringify(stats)}\n`);
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    process.exitCode = 1;
  }
}
