import { attachDatabasePool } from '@neon/functions';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { getEnv } from '../env';

export type Db = NodePgDatabase;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export function createDb(url: string): { pool: Pool; db: Db } {
  const pool = new Pool({ connectionString: url, max: 5 });
  attachDatabasePool(pool);
  return { pool, db: drizzle(pool) };
}

let defaultDb: Db | undefined;

/** Process-wide instance on DATABASE_URL; created on first use so importing stays side-effect free. */
export function getDb(): Db {
  defaultDb ??= createDb(getEnv().DATABASE_URL).db;
  return defaultDb;
}

/** Runs `fn` in one transaction: commits on return, rolls back every write on throw. */
export function withTransaction<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(fn);
}
