import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { assertNotProduction, requireTestDatabaseUrl } from '../../test/require-test-db';
import { createUser } from '../../test/factories';
import { createDb } from './client';
import { runMigrations } from './migrate';
import { auditLog, consents } from './schema';

const journal = JSON.parse(
  readFileSync(new URL('../../drizzle/meta/_journal.json', import.meta.url), 'utf8'),
) as { entries: unknown[] };
const testUrl = requireTestDatabaseUrl(process.env);
const { pool, db } = createDb(testUrl);

afterAll(async () => {
  await pool.end();
});

const BASE_TABLES = [
  'users',
  'sessions',
  'auth_tokens',
  'user_totp',
  'consents',
  'rate_limit_buckets',
  'rooms',
  'room_photos',
  'settings',
  'business_hours',
  'holidays',
  'closed_days',
  'block_recurrences',
  'blocks',
  'room_occupancy',
  'audit_log',
  'email_outbox',
  'integration_settings',
];

async function createRoom(slug: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into rooms (slug, name) values ($1, $1) returning id`,
    [slug],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('room insert returned no row');
  return id;
}

/** Inserts an occupancy row for `[from, to)` on 2026-03-02 (UTC) and returns the pg result. */
function occupy(roomId: string, from: string, to: string, active = true) {
  return pool.query(
    `insert into room_occupancy (room_id, period, kind, ref_id, active)
     values ($1, tstzrange($2::timestamptz, $3::timestamptz, '[)'), 'booking', gen_random_uuid(), $4)`,
    [roomId, `2026-03-02T${from}:00Z`, `2026-03-02T${to}:00Z`, active],
  );
}

async function sqlState(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

describe('base migrations (FND-30, FND-31, FND-36)', () => {
  it('creates the 18 base tables and the btree_gist extension', async () => {
    const tables = await pool.query<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema = 'public' and table_type = 'BASE TABLE'`,
    );
    const extension = await pool.query(`select 1 from pg_extension where extname = 'btree_gist'`);

    const present = tables.rows.map((row) => row.table_name);
    for (const table of BASE_TABLES) expect(present).toContain(table);
    expect(extension.rowCount).toBe(1);
  });

  it('applies no statements when run a second time', async () => {
    const count = async () =>
      (
        await pool.query<{ n: string }>(
          `select count(*)::text as n from drizzle.__drizzle_migrations`,
        )
      ).rows[0]?.n;
    const before = await count();

    await runMigrations(testUrl);

    expect(before).toBe(String(journal.entries.length));
    expect(await count()).toBe(before);
  });

  it('stores instants as timestamptz and no column as timestamp without time zone', async () => {
    const columns = await pool.query<{ column_name: string; data_type: string }>(
      `select column_name, data_type from information_schema.columns where table_schema = 'public'`,
    );

    const naive = columns.rows.filter((c) => c.data_type === 'timestamp without time zone');
    const instants = columns.rows.filter((c) => /_at$/.test(c.column_name));
    expect(naive).toEqual([]);
    expect(instants.length).toBeGreaterThan(0);
    expect(instants.every((c) => c.data_type === 'timestamp with time zone')).toBe(true);
  });
});

describe('room_occupancy exclusion constraint (FND-32, FND-33, FND-34)', () => {
  it('rejects a second active overlapping row of the same room with SQLSTATE 23P01', async () => {
    const room = await createRoom('principal');
    await occupy(room, '09:00', '11:30');

    expect(await sqlState(occupy(room, '10:00', '12:00'))).toBe('23P01');
  });

  it('accepts [09:00,11:30) followed by [11:30,12:30) in the same room', async () => {
    const room = await createRoom('principal');

    await occupy(room, '09:00', '11:30');
    await occupy(room, '11:30', '12:30');

    const { rows } = await pool.query<{ n: string }>(
      `select count(*)::text as n from room_occupancy where room_id = $1`,
      [room],
    );
    expect(rows[0]?.n).toBe('2');
  });

  it('accepts an overlapping row while the existing one has active = false', async () => {
    const room = await createRoom('principal');
    await occupy(room, '09:00', '11:30', false);

    await occupy(room, '10:00', '12:00');

    const { rows } = await pool.query<{ n: string }>(
      `select count(*)::text as n from room_occupancy where room_id = $1`,
      [room],
    );
    expect(rows[0]?.n).toBe('2');
  });

  it('accepts overlapping rows of different rooms', async () => {
    const first = await createRoom('principal');
    const second = await createRoom('secundaria');

    await occupy(first, '09:00', '11:30');
    await occupy(second, '09:00', '11:30');

    const { rows } = await pool.query<{ n: string }>(
      `select count(*)::text as n from room_occupancy`,
    );
    expect(rows[0]?.n).toBe('2');
  });

  it('rejects an empty period and a period with an inclusive upper bound (check 23514)', async () => {
    const room = await createRoom('principal');
    const insert = (range: string) =>
      pool.query(
        `insert into room_occupancy (room_id, period, kind, ref_id)
         values ($1, ${range}, 'booking', gen_random_uuid())`,
        [room],
      );

    expect(await sqlState(insert(`'empty'::tstzrange`))).toBe('23514');
    expect(
      await sqlState(insert(`tstzrange('2026-03-02T09:00Z', '2026-03-02T10:00Z', '[]')`)),
    ).toBe('23514');
  });
});

describe('closed_days_uq', () => {
  it('rejects a second whole-clinic closure on the same date and accepts a room closure', async () => {
    const room = await createRoom('principal');
    await pool.query(`insert into closed_days (date) values ('2026-03-02')`);

    expect(await sqlState(pool.query(`insert into closed_days (date) values ('2026-03-02')`))).toBe(
      '23505',
    );
    await pool.query(`insert into closed_days (date, room_id) values ('2026-03-02', $1)`, [room]);
  });
});

describe('append-only tables (FND-35)', () => {
  it('raises append_only_table on UPDATE of audit_log and leaves the row unchanged', async () => {
    await db.insert(auditLog).values({
      origin: 'system',
      action: 'user.created',
      entityType: 'user',
      justification: 'original',
    });

    await expect(pool.query(`update audit_log set justification = 'changed'`)).rejects.toThrow(
      'append_only_table',
    );

    const { rows } = await pool.query<{ justification: string }>(
      `select justification from audit_log`,
    );
    expect(rows.map((row) => row.justification)).toEqual(['original']);
  });

  it('raises append_only_table on DELETE of consents and leaves the row unchanged', async () => {
    const user = await createUser(db);
    await db.insert(consents).values({ userId: user.id, kind: 'terms', version: 'terms-2026-10' });

    await expect(pool.query(`delete from consents`)).rejects.toThrow('append_only_table');

    const { rows } = await pool.query<{ n: string }>(`select count(*)::text as n from consents`);
    expect(rows[0]?.n).toBe('1');
  });
});

describe('test database guard (AD-018)', () => {
  const production = 'postgres://u:p@ep-prod-123.us-east-1.aws.neon.tech/bravo';

  it('refuses a test URL equal to the production URL, pooled or unpooled', () => {
    const pooled =
      'postgres://u:p@ep-prod-123-pooler.us-east-1.aws.neon.tech/bravo?sslmode=require';

    expect(() => assertNotProduction(production, { urls: [pooled] })).toThrow(
      'DATABASE_URL_TEST points at the production database',
    );
    expect(() => assertNotProduction(pooled, { urls: [production] })).toThrow(
      'DATABASE_URL_TEST points at the production database',
    );
  });

  it('refuses a test URL that contains the production branch id', () => {
    const url = 'postgres://u:p@ep-dev-9.neon.tech/br-polished-1';

    expect(() => assertNotProduction(url, { urls: [], branchId: 'br-polished-1' })).toThrow(
      'DATABASE_URL_TEST targets the production branch',
    );
  });

  it('accepts a different database', () => {
    const dev = 'postgres://u:p@ep-dev-9.us-east-1.aws.neon.tech/bravo';

    expect(() =>
      assertNotProduction(dev, { urls: [production, undefined], branchId: 'br-polished-1' }),
    ).not.toThrow();
  });
});
