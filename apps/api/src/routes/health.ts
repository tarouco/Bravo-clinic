import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { logger } from '../lib/logger';
import type { AppEnv } from '../types';

// A scale-to-zero compute needs a few seconds to wake up; never degrade earlier than this.
const DB_TIMEOUT_MS = 10_000;

async function pingDatabase(run: () => Promise<unknown>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('database timeout')), DB_TIMEOUT_MS);
  });
  try {
    await Promise.race([run(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export function healthRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.get('/', async (c) => {
    const { db, env } = c.var.deps;
    try {
      await pingDatabase(() => db.execute(sql`select 1`));
    } catch (error) {
      logger.warn('health check failed', {
        requestId: c.var.requestId,
        reason: error instanceof Error ? error.message : 'unknown',
      });
      return c.json({ status: 'degraded', db: 'error' }, 503);
    }
    return c.json({ status: 'ok', db: 'ok', branch: env.NEON_BRANCH ?? null });
  });
  return app;
}
