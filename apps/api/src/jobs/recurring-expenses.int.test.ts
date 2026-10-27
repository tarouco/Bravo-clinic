import { localToUtc, type LocalDate } from '@bravo/core';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { forbiddenFetch, testEnv } from '../../test/http';
import { requireTestDatabaseUrl } from '../../test/require-test-db';
import { createDb } from '../db/client';
import { auditLog, expenseCategories, expenses, jobRuns } from '../db/schema';
import { runSeed } from '../db/seed';
import { createRegistry } from '../extensions/registry';
import { getJob, runJob } from './index';
import { recurringExpenses } from './recurring-expenses';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

let categoryId = '';

beforeEach(async () => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  await runSeed(db);
  const [first] = await db
    .select()
    .from(expenseCategories)
    .orderBy(asc(expenseCategories.displayOrder));
  categoryId = first?.id ?? '';
});

/** Local noon of `date` (the job runs at 06:00 BRT; the time of day does not matter). */
const noonOf = (date: LocalDate) => localToUtc(date, 720);

const deps = (date: LocalDate) => ({
  db,
  env: testEnv(),
  fetch: forbiddenFetch,
  now: () => noonOf(date),
  registry: createRegistry(),
});

const run = (date: LocalDate) => recurringExpenses(deps(date), noonOf(date));

async function parent(date: string, recurrence: string, amountCents = 30_000) {
  const [row] = await db
    .insert(expenses)
    .values({ date, categoryId, description: `Aluguel ${recurrence}`, amountCents, recurrence })
    .returning();
  if (row === undefined) throw new Error('parent insert returned no row');
  return row;
}

const childrenOf = async (parentId: string) =>
  (
    await db
      .select()
      .from(expenses)
      .where(eq(expenses.recurrenceParentId, parentId))
      .orderBy(asc(expenses.date))
  ).map((r) => ({ date: r.date, recurrence: r.recurrence, amountCents: r.amountCents }));

describe('recurring-expenses job (GES-14, GES-15)', () => {
  it('materializes a month-end parent with the day clamped, never ahead of today', async () => {
    const monthly = await parent('2026-01-31', 'monthly');

    const early = await run('2026-02-27');
    const afterEarly = await childrenOf(monthly.id);
    const stats = await run('2026-03-30');
    const beforeMarchEnd = await childrenOf(monthly.id);
    await run('2026-03-31');

    expect(early).toEqual({ parents: 1, created: 0 });
    expect(afterEarly).toEqual([]);
    expect(stats).toEqual({ parents: 1, created: 1 });
    expect(beforeMarchEnd.map((c) => c.date)).toEqual(['2026-02-28']);
    expect(await childrenOf(monthly.id)).toEqual([
      { date: '2026-02-28', recurrence: 'none', amountCents: 30_000 },
      { date: '2026-03-31', recurrence: 'none', amountCents: 30_000 },
    ]);
    const [child] = await db.select().from(expenses).where(eq(expenses.date, '2026-02-28'));
    expect(child).toMatchObject({
      categoryId,
      description: 'Aluguel monthly',
      recurrenceParentId: monthly.id,
    });
  });

  it('follows quarterly and yearly cadences', async () => {
    const quarterly = await parent('2026-01-15', 'quarterly');
    const yearly = await parent('2024-02-29', 'yearly');

    await run('2026-07-20');

    expect((await childrenOf(quarterly.id)).map((c) => c.date)).toEqual([
      '2026-04-15',
      '2026-07-15',
    ]);
    expect((await childrenOf(yearly.id)).map((c) => c.date)).toEqual(['2025-02-28', '2026-02-28']);
  });

  it('creates no duplicates on a re-run and audits each child with origin job', async () => {
    const monthly = await parent('2026-01-31', 'monthly');

    const first = await run('2026-03-31');
    const second = await run('2026-03-31');

    expect(first.created).toBe(2);
    expect(second).toEqual({ parents: 1, created: 0 });
    expect(await childrenOf(monthly.id)).toHaveLength(2);
    const entries = await db.select().from(auditLog).where(eq(auditLog.action, 'expense.create'));
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      origin: 'job',
      actorUserId: null,
      after: { recurrenceParentId: monthly.id },
    });
  });

  it('stops a parent switched to none and keeps its existing children', async () => {
    const monthly = await parent('2026-01-10', 'monthly');
    await run('2026-03-15');
    await db.update(expenses).set({ recurrence: 'none' }).where(eq(expenses.id, monthly.id));

    const stats = await run('2026-06-15');

    expect(stats).toEqual({ parents: 0, created: 0 });
    expect((await childrenOf(monthly.id)).map((c) => c.date)).toEqual(['2026-02-10', '2026-03-10']);
  });

  it('skips deleted parents, does not re-create a deleted child, and is a registered job', async () => {
    const deleted = await parent('2026-01-05', 'monthly');
    await db
      .update(expenses)
      .set({ deletedAt: noonOf('2026-01-06') })
      .where(eq(expenses.id, deleted.id));
    const live = await parent('2026-01-05', 'monthly', 12_000);
    await run('2026-02-05');
    await db
      .update(expenses)
      .set({ deletedAt: noonOf('2026-02-06') })
      .where(eq(expenses.recurrenceParentId, live.id));

    const job = getJob('recurring-expenses');
    const stats =
      job === undefined ? null : await runJob('recurring-expenses', job, deps('2026-03-05'));

    expect(await childrenOf(deleted.id)).toEqual([]);
    expect((await childrenOf(live.id)).map((c) => c.date)).toEqual(['2026-02-05', '2026-03-05']);
    expect(stats).toEqual({ parents: 1, created: 1 });
    const [runRow] = await db.select().from(jobRuns).where(eq(jobRuns.job, 'recurring-expenses'));
    expect(runRow).toMatchObject({ status: 'ok', stats: { parents: 1, created: 1 } });
  });
});
