import { sql } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { logsDeVsl } from '../../db/schema';
import { badRequest, tooManyRequests, validationFailed } from '../../lib/errors';
import { requestMeta } from '../../lib/request-meta';
import { consumeRateLimit, rateLimitKey } from '../../middleware/rate-limit';
import type { AppEnv } from '../../types';

/** Calls per IP per hour on each endpoint: a visitor makes one of each. */
const LIMIT_PER_HOUR = 30;
/** An `openedAt` older than this (or in the future) is replaced by the closing time. */
const MAX_OPEN_MS = 6 * 60 * 60 * 1000;

const vslLogSchema = z.object({
  video: z.string().regex(/^[A-Za-z0-9._-]{1,120}$/),
  turn: z.number().int().min(0).nullable().optional(),
  openedAt: z.iso.datetime(),
  playedSeconds: z.number().min(0).max(36_000),
  durationSeconds: z.number().min(0).max(36_000).nullable().optional(),
  exit: z.enum(['click', 'escape', 'pagehide']),
  device: z.enum(['mobile', 'desktop']),
});

async function limitPerIp(c: Context<AppEnv>, bucket: string): Promise<void> {
  const { db, now } = c.var.deps;
  const result = await consumeRateLimit(db, rateLimitKey(bucket, requestMeta(c).ip ?? 'unknown'), {
    limit: LIMIT_PER_HOUR,
    windowSeconds: 3600,
    now: now(),
  });
  if (!result.allowed) throw tooManyRequests(result.retryAfterSeconds);
}

/**
 * Home intro video (VSL): `POST /public/vsl/turn` hands out the next rotation turn, so consecutive
 * first-time visitors get alternating videos; `POST /public/vsl/logs` records where a visitor left
 * the video in `Logs_de_VSL`. Nothing here reads the log back.
 */
export function vslRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post('/vsl/turn', async (c) => {
    await limitPerIp(c, 'vsl-turn');
    const { rows } = await c.var.deps.db.execute<{ turn: string }>(
      sql`select nextval('vsl_rotation_seq') as turn`,
    );
    return c.json({ turn: Number(rows[0]?.turn ?? 0) });
  });

  app.post('/vsl/logs', async (c) => {
    await limitPerIp(c, 'vsl-log');
    const raw: unknown = await c.req.json().catch(() => {
      throw badRequest();
    });
    const parsed = vslLogSchema.safeParse(raw);
    if (!parsed.success) throw validationFailed(parsed.error.issues);
    const input = parsed.data;

    const meta = requestMeta(c);
    const closedAt = c.var.deps.now();
    const openedAt = new Date(input.openedAt);
    const age = closedAt.getTime() - openedAt.getTime();
    await c.var.deps.db.insert(logsDeVsl).values({
      ip: meta.ip,
      accessedAt: age >= 0 && age <= MAX_OPEN_MS ? openedAt : closedAt,
      closedAt,
      videoName: input.video,
      playedSeconds: input.playedSeconds.toFixed(3),
      durationSeconds: input.durationSeconds?.toFixed(3) ?? null,
      turn: input.turn ?? null,
      exitMethod: input.exit,
      device: input.device,
      userAgent: meta.userAgent,
    });
    return c.body(null, 204);
  });

  return app;
}
