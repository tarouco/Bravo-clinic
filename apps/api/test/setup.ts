import { Pool } from 'pg';
import { afterAll, beforeEach, expect } from 'vitest';
import { requireTestDatabaseUrl } from './require-test-db';

let pool: Pool | undefined;

/** Empties every table of schema `public`. TRUNCATE is not blocked by the append-only row triggers. */
export async function truncateAll(target: Pool): Promise<void> {
  const { rows } = await target.query<{ tablename: string }>(
    `select tablename from pg_tables where schemaname = 'public'`,
  );
  if (rows.length === 0) return;
  const names = rows.map((row) => `"${row.tablename.replaceAll('"', '""')}"`).join(', ');
  await target.query(`truncate table ${names} restart identity cascade`);
}

// Only integration test files touch the database; unit tests skip the round trip.
beforeEach(async () => {
  if (!(expect.getState().testPath ?? '').endsWith('.int.test.ts')) return;
  pool ??= new Pool({ connectionString: requireTestDatabaseUrl(process.env), max: 1 });
  await truncateAll(pool);
});

afterAll(async () => {
  await pool?.end();
  pool = undefined;
});
