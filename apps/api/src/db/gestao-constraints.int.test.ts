import { asc, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { settingDefaults } from '@bravo/core';
import { createUser } from '../../test/factories';
import { requireTestDatabaseUrl } from '../../test/require-test-db';
import { createDb } from './client';
import {
  expenseCategories,
  expenses,
  extraServices,
  icsFeedTokens,
  rooms,
  settings,
} from './schema';
import { runSeed } from './seed';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

/** SQLSTATE of a rejected statement (drizzle wraps the pg error in `cause`). */
async function sqlState(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    const err = error as { code?: string; cause?: { code?: string } };
    return err.cause?.code ?? err.code;
  }
  return undefined;
}

// docs/architecture.md section 5.5, in PRD order.
const EXPENSE_CATEGORIES = [
  'Aluguel',
  'Condomínio e IPTU',
  'Energia',
  'Água',
  'Internet',
  'Limpeza e higienização',
  'Manutenção',
  'Materiais e insumos',
  'Marketing',
  'Pessoal',
  'Contabilidade',
  'Taxas do gateway',
  'Impostos',
  'Outros',
];

const GESTAO_TABLES = [
  'expense_categories',
  'expenses',
  'manual_receipts',
  'extra_services',
  'booking_extra_items',
  'quote_requests',
  'notification_recipients',
  'push_subscriptions',
  'ics_feed_tokens',
  'mcp_tokens',
];

let tokenSeq = 0;
const feed = (values: Partial<typeof icsFeedTokens.$inferInsert>) => {
  tokenSeq += 1;
  return db
    .insert(icsFeedTokens)
    .values({
      scope: 'clinic',
      tokenHash: `hash-${String(tokenSeq)}-${String(Date.now())}`,
      tokenPrefix: 'abcdef',
      ...values,
    })
    .returning();
};

async function firstRoomId(): Promise<string> {
  const [room] = await db.select({ id: rooms.id }).from(rooms).orderBy(asc(rooms.displayOrder));
  if (room === undefined) throw new Error('seed created no room');
  return room.id;
}

describe('gestao migration (docs/architecture.md section 5.5)', () => {
  it('creates every section 5.5 table', async () => {
    const { rows } = await pool.query<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema = 'public' and table_type = 'BASE TABLE'`,
    );
    const present = rows.map((row) => row.table_name);
    for (const table of GESTAO_TABLES) expect(present, table).toContain(table);
  });
});

describe('ics feed token constraints (GES-42)', () => {
  it('rejects a second active clinic feed with 23505 and accepts it after the first is revoked', async () => {
    const [first] = await feed({ scope: 'clinic' });
    expect(await sqlState(feed({ scope: 'clinic' }))).toBe('23505');

    await db
      .update(icsFeedTokens)
      .set({ revokedAt: new Date() })
      .where(eq(icsFeedTokens.id, first?.id ?? ''));
    const [second] = await feed({ scope: 'clinic' });
    expect(second?.revokedAt).toBeNull();
  });

  it('keeps one active feed per room and one per user', async () => {
    await runSeed(db);
    const roomId = await firstRoomId();
    const user = await createUser(db);
    await feed({ scope: 'room', roomId });
    await feed({ scope: 'user', userId: user.id });

    expect(await sqlState(feed({ scope: 'room', roomId }))).toBe('23505');
    expect(await sqlState(feed({ scope: 'user', userId: user.id }))).toBe('23505');
  });

  it('rejects scope/user/room mismatches with 23514', async () => {
    await runSeed(db);
    const roomId = await firstRoomId();
    const user = await createUser(db);

    expect(await sqlState(feed({ scope: 'user' }))).toBe('23514');
    expect(await sqlState(feed({ scope: 'room' }))).toBe('23514');
    expect(await sqlState(feed({ scope: 'clinic', userId: user.id }))).toBe('23514');
    expect(await sqlState(feed({ scope: 'clinic', roomId }))).toBe('23514');
    expect(await sqlState(feed({ scope: 'user', userId: user.id, roomId }))).toBe('23514');
  });
});

describe('expense recurrence constraints (GES-14)', () => {
  it('rejects a duplicate (recurrence_parent_id, date) child with 23505', async () => {
    await runSeed(db);
    const [category] = await db.select().from(expenseCategories).limit(1);
    const base = {
      categoryId: category?.id ?? '',
      description: 'Aluguel da sala',
      amountCents: 500_000,
    };
    const [parent] = await db
      .insert(expenses)
      .values({ ...base, date: '2026-01-31', recurrence: 'monthly' })
      .returning();
    const child = { ...base, date: '2026-02-28', recurrenceParentId: parent?.id ?? '' };
    await db.insert(expenses).values(child);

    expect(await sqlState(db.insert(expenses).values(child))).toBe('23505');
  });

  it('accepts the same date again once the previous child is soft-deleted', async () => {
    await runSeed(db);
    const [category] = await db.select().from(expenseCategories).limit(1);
    const base = { categoryId: category?.id ?? '', description: 'Internet', amountCents: 15_000 };
    const [parent] = await db
      .insert(expenses)
      .values({ ...base, date: '2026-01-10', recurrence: 'monthly' })
      .returning();
    const child = { ...base, date: '2026-02-10', recurrenceParentId: parent?.id ?? '' };
    await db.insert(expenses).values({ ...child, deletedAt: new Date() });

    expect(await sqlState(db.insert(expenses).values(child))).toBeUndefined();
  });

  it('rejects a category name differing only in case with 23505', async () => {
    await runSeed(db);
    expect(
      await sqlState(db.insert(expenseCategories).values({ name: 'aluguel', displayOrder: 99 })),
    ).toBe('23505');
  });
});

describe('gestao seeds (design.md "Seeds")', () => {
  it('seeds the 14 expense categories in PRD order with distinct display orders', async () => {
    await runSeed(db);
    await runSeed(db);

    const rows = await db
      .select()
      .from(expenseCategories)
      .orderBy(asc(expenseCategories.displayOrder));
    expect(rows.map((row) => row.name)).toEqual(EXPENSE_CATEGORIES);
    expect(rows.map((row) => row.displayOrder)).toEqual(EXPENSE_CATEGORIES.map((_, i) => i + 1));
    expect(rows.every((row) => row.active)).toBe(true);
  });

  it('seeds the 3 extra services in quote mode', async () => {
    await runSeed(db);
    await runSeed(db);

    const rows = await db.select().from(extraServices).orderBy(asc(extraServices.displayOrder));
    expect(
      rows.map((row) => [row.name, row.referencePriceCents, row.unit, row.saleMode, row.status]),
    ).toEqual([
      ['Pacote de filmagem', 8000, 'hour', 'quote', 'active'],
      ['Videomaker', null, 'project', 'quote', 'active'],
      ['Marketing digital', null, 'project', 'quote', 'active'],
    ]);
  });

  it('keeps edited (and renamed) seed rows unchanged on a rerun', async () => {
    await runSeed(db);
    await db
      .update(expenseCategories)
      .set({ name: 'Aluguel da sede', active: false })
      .where(eq(expenseCategories.name, 'Aluguel'));
    await db
      .update(extraServices)
      .set({ referencePriceCents: 9500, saleMode: 'online' })
      .where(eq(extraServices.name, 'Pacote de filmagem'));

    await runSeed(db);

    const categories = await db.select().from(expenseCategories);
    expect(categories).toHaveLength(14);
    expect(categories.find((row) => row.displayOrder === 1)).toMatchObject({
      name: 'Aluguel da sede',
      active: false,
    });
    const services = await db.select().from(extraServices);
    expect(services).toHaveLength(3);
    expect(services.find((row) => row.name === 'Pacote de filmagem')).toMatchObject({
      referencePriceCents: 9500,
      saleMode: 'online',
    });
  });

  it('seeds usage.limits with the factory defaults', async () => {
    await runSeed(db);
    const [row] = await db.select().from(settings).where(eq(settings.key, 'usage.limits'));
    expect(row?.value).toEqual(settingDefaults()['usage.limits']);
  });
});
