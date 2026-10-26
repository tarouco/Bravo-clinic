import { Hono } from 'hono';
import { getJob, runJob } from '../jobs';
import { logger } from '../lib/logger';
import { notFound, unauthorized } from '../lib/errors';
import { verifyTriggerRequest } from '../lib/trigger-auth';
import type { AppEnv } from '../types';

/**
 * `POST /jobs/:name` (NUC-195): the Function Trigger deliveries. Authentication is the trigger
 * delivery itself, never a session; an unverified request runs nothing and writes nothing.
 */
export function jobRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post('/:name', async (c) => {
    const deps = c.var.deps;
    const delivery = await (deps.verifyTrigger ?? verifyTriggerRequest)(c.req.raw);
    if (delivery === null) throw unauthorized();
    const name = c.req.param('name');
    const job = getJob(name);
    if (job === undefined) throw notFound('NOT_FOUND', 'Job não encontrado');
    try {
      const stats = await runJob(name, job, deps, delivery.invocationId);
      return c.json({ job: name, stats });
    } catch {
      // The message is already in `job_runs`; the trigger only sees a failed delivery.
      logger.error('job route failed', { job: name, requestId: c.get('requestId') });
      return c.json({ job: name, error: 'JOB_FAILED' }, 500);
    }
  });

  return app;
}
