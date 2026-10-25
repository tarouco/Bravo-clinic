import { afterAll, describe, expect, it } from 'vitest';
import { requireTestDatabaseUrl } from '../../test/require-test-db';
import { createDb } from '../db/client';
import { rateLimitBuckets } from '../db/schema';
import { sha256Hex } from '../lib/crypto';
import { consumeRateLimit, peekRateLimit, rateLimitKey } from './rate-limit';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

const WINDOW = { limit: 5, windowSeconds: 900 };
const T0 = new Date('2026-10-27T12:00:00.000Z'); // aligned to a 900 s window start

describe('consumeRateLimit (FND-54, FND-50, FND-69 mechanism)', () => {
  it('allows calls 1-5 and denies call 6 with a retry-after inside the window', async () => {
    const key = rateLimitKey('login', 'ana@bravoclinic.test');
    const now = new Date(T0.getTime() + 60_000);

    const results = [];
    for (let i = 0; i < 6; i++) results.push(await consumeRateLimit(db, key, { ...WINDOW, now }));

    expect(results.slice(0, 5).map((r) => r.allowed)).toEqual([true, true, true, true, true]);
    expect(results[5]?.allowed).toBe(false);
    expect(results[5]?.retryAfterSeconds).toBe(840);
  });

  it('allows again in the next window and keeps different keys independent', async () => {
    const key = rateLimitKey('login', 'ana@bravoclinic.test');
    const otherKey = rateLimitKey('login', 'bia@bravoclinic.test');
    for (let i = 0; i < 6; i++) await consumeRateLimit(db, key, { ...WINDOW, now: T0 });

    const nextWindow = new Date(T0.getTime() + 900_000);
    const again = await consumeRateLimit(db, key, { ...WINDOW, now: nextWindow });
    const other = await consumeRateLimit(db, otherKey, { ...WINDOW, now: T0 });

    expect(again.allowed).toBe(true);
    expect(other.allowed).toBe(true);
  });

  it('counts exactly 5 of 10 concurrent calls as allowed', async () => {
    const key = rateLimitKey('login', 'race@bravoclinic.test');

    const results = await Promise.all(
      Array.from({ length: 10 }, () => consumeRateLimit(db, key, { ...WINDOW, now: T0 })),
    );

    expect(results.filter((r) => r.allowed)).toHaveLength(5);
  });

  it('stores only hashed keys, never the raw e-mail', async () => {
    const email = 'privado@bravoclinic.test';

    await consumeRateLimit(db, rateLimitKey('login', email), { ...WINDOW, now: T0 });

    const rows = await db.select().from(rateLimitBuckets);
    expect(rows.map((r) => r.key)).toEqual([`login:${sha256Hex(email)}`]);
    expect(rows.some((r) => r.key.includes('privado'))).toBe(false);
  });
});

describe('peekRateLimit', () => {
  it('reads the count without incrementing and blocks once the limit is reached', async () => {
    const key = rateLimitKey('login', 'peek@bravoclinic.test');
    const opts = { ...WINDOW, now: T0 };

    expect((await peekRateLimit(db, key, opts)).allowed).toBe(true);
    for (let i = 0; i < 4; i++) await consumeRateLimit(db, key, opts);
    expect((await peekRateLimit(db, key, opts)).allowed).toBe(true);
    await consumeRateLimit(db, key, opts);

    const blocked = await peekRateLimit(db, key, opts);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(900);
    const [row] = await db.select().from(rateLimitBuckets);
    expect(row?.count).toBe(5);
  });
});
