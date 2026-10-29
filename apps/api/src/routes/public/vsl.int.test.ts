import { desc } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { forbiddenFetch, send, testEnv } from '../../../test/http';
import { requireTestDatabaseUrl } from '../../../test/require-test-db';
import { createApp } from '../../app';
import { createDb } from '../../db/client';
import { logsDeVsl } from '../../db/schema';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));
const NOW = new Date('2026-10-29T22:00:00Z');

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await db.delete(logsDeVsl);
});

const app = () => createApp({ db, now: () => NOW, fetch: forbiddenFetch, env: testEnv() });

const validLog = {
  video: 'propaganda-instagram-01',
  turn: 4,
  openedAt: '2026-10-29T21:59:30.000Z',
  playedSeconds: 12.345,
  durationSeconds: 17.05,
  exit: 'click',
  device: 'mobile',
};

describe('POST /public/vsl/turn', () => {
  it('hands out consecutive turns, so visitors alternate between the videos', async () => {
    const first = await send(app(), 'POST', '/public/vsl/turn');
    const second = await send(app(), 'POST', '/public/vsl/turn');

    expect(first.status).toBe(200);
    const a = (first.body as { turn: number }).turn;
    const b = (second.body as { turn: number }).turn;
    expect(b).toBe(a + 1);
  });
});

describe('POST /public/vsl/logs', () => {
  it('stores the IP, access time, video and the position where the visitor left', async () => {
    const res = await send(app(), 'POST', '/public/vsl/logs', {
      body: validLog,
      headers: { 'X-Nf-Client-Connection-Ip': '203.0.113.7', 'User-Agent': 'test-agent' },
    });

    expect(res.status).toBe(204);
    const [row] = await db.select().from(logsDeVsl).orderBy(desc(logsDeVsl.id)).limit(1);
    expect(row).toMatchObject({
      ip: '203.0.113.7',
      accessedAt: new Date('2026-10-29T21:59:30.000Z'),
      closedAt: NOW,
      videoName: 'propaganda-instagram-01',
      playedSeconds: '12.345',
      durationSeconds: '17.050',
      turn: 4,
      exitMethod: 'click',
      device: 'mobile',
      userAgent: 'test-agent',
    });
  });

  it('replaces an access time in the future or too old by the closing time', async () => {
    await send(app(), 'POST', '/public/vsl/logs', {
      body: { ...validLog, openedAt: '2026-10-30T22:00:00.000Z' },
    });

    const [row] = await db.select().from(logsDeVsl).limit(1);
    expect(row?.accessedAt).toEqual(NOW);
  });

  it('rejects an unknown exit method or a negative position with 422', async () => {
    const badExit = await send(app(), 'POST', '/public/vsl/logs', {
      body: { ...validLog, exit: 'swipe' },
    });
    const negative = await send(app(), 'POST', '/public/vsl/logs', {
      body: { ...validLog, playedSeconds: -1 },
    });

    expect(badExit.error?.code).toBe('VALIDATION_FAILED');
    expect(negative.error?.code).toBe('VALIDATION_FAILED');
    expect(await db.select().from(logsDeVsl)).toHaveLength(0);
  });
});
