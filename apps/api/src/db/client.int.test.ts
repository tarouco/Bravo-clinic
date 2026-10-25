import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { requireTestDatabaseUrl } from '../../test/require-test-db';
import { createDb, withTransaction } from './client';

const table = `tx_probe_${randomBytes(6).toString('hex')}`;
const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

async function countRows(): Promise<number> {
  const result = await db.execute<{ n: string }>(
    sql`select count(*)::text as n from ${sql.identifier(table)}`,
  );
  return Number(result.rows[0]?.n);
}

beforeAll(async () => {
  await db.execute(sql`create table ${sql.identifier(table)} (id integer primary key)`);
});

afterAll(async () => {
  await db.execute(sql`drop table if exists ${sql.identifier(table)}`);
  await pool.end();
});

describe('createDb', () => {
  it('builds a pool capped at 5 connections that answers queries', async () => {
    const result = await db.execute<{ one: number }>(sql`select 1 as one`);

    expect(pool.options.max).toBe(5);
    expect(result.rows[0]?.one).toBe(1);
  });
});

describe('withTransaction (FND-28)', () => {
  it('rolls back every write when the callback throws, and rethrows the error', async () => {
    const failure = new Error('boom');

    await expect(
      withTransaction(db, async (tx) => {
        await tx.execute(sql`insert into ${sql.identifier(table)} (id) values (1)`);
        throw failure;
      }),
    ).rejects.toBe(failure);

    expect(await countRows()).toBe(0);
  });

  it('commits and returns the callback value on success', async () => {
    const value = await withTransaction(db, async (tx) => {
      await tx.execute(sql`insert into ${sql.identifier(table)} (id) values (2)`);
      return 'done';
    });

    expect(value).toBe('done');
    expect(await countRows()).toBe(1);
  });
});

describe('integration test setup', () => {
  it('fails loudly when DATABASE_URL_TEST is missing or empty instead of skipping', () => {
    const message = 'DATABASE_URL_TEST is required for integration tests';

    expect(() => requireTestDatabaseUrl({})).toThrow(message);
    expect(() => requireTestDatabaseUrl({ DATABASE_URL_TEST: '' })).toThrow(message);
  });

  it('returns the configured URL when present', () => {
    expect(requireTestDatabaseUrl({ DATABASE_URL_TEST: 'postgres://x/y' })).toBe('postgres://x/y');
  });
});
