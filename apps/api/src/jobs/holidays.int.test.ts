import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createUser } from '../../test/factories';
import { forbiddenFetch, testEnv } from '../../test/http';
import { requireTestDatabaseUrl } from '../../test/require-test-db';
import { createDb } from '../db/client';
import { emailOutbox, holidays, jobRuns, users } from '../db/schema';
import { runSeed } from '../db/seed';
import { createRegistry } from '../extensions/registry';
import { getJob, runJob } from './index';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  await runSeed(db);
});

const deps = (now: Date, fetch: typeof globalThis.fetch = forbiddenFetch) => ({
  db,
  env: testEnv(),
  fetch,
  now: () => now,
  registry: createRegistry(),
});

const run = async (name: string, now: Date, fetch?: typeof globalThis.fetch) => {
  const job = getJob(name);
  if (job === undefined) throw new Error(`job ${name} is not registered`);
  return runJob(name, job, deps(now, fetch));
};

describe('holiday-reminder job (GES-130)', () => {
  // 09:00 in São Paulo on 2026-10-01 (the default reminder date) and on the next day.
  const OCT_1 = new Date('2026-10-01T12:00:00.000Z');
  const OCT_2 = new Date('2026-10-02T12:00:00.000Z');

  async function staff() {
    const first = await createUser(db, { role: 'admin', email: 'ana@bravoclinic.test' });
    const second = await createUser(db, { role: 'admin', email: 'bruno@bravoclinic.test' });
    const disabled = await createUser(db, { role: 'admin', email: 'velha@bravoclinic.test' });
    await db.update(users).set({ status: 'disabled' }).where(eq(users.id, disabled.id));
    await createUser(db, { role: 'reception', email: 'recepcao@bravoclinic.test' });
    return { first, second };
  }

  it('queues staff.holiday_review to every active admin on the reminder date', async () => {
    await staff();

    const stats = await run('holiday-reminder', OCT_1);

    const rows = await db.select().from(emailOutbox);
    expect(rows.map((r) => r.toAddress).sort()).toEqual([
      'ana@bravoclinic.test',
      'bruno@bravoclinic.test',
    ]);
    expect(rows.every((r) => r.template === 'staff.holiday_review')).toBe(true);
    expect(rows[0]?.subject).toBe('Revise os feriados do calendário');
    // The upcoming holidays are listed (Nossa Senhora Aparecida, 12/10).
    expect(rows[0]?.textBody).toContain('12/10/2026: Nossa Senhora Aparecida');
    expect(stats).toEqual({ due: true, admins: 2 });
  });

  it('queues nothing new when it runs again on the same date', async () => {
    await staff();

    await run('holiday-reminder', OCT_1);
    await run('holiday-reminder', new Date('2026-10-01T20:00:00.000Z'));

    expect(await db.select().from(emailOutbox)).toHaveLength(2);
  });

  it('does nothing on any other date', async () => {
    await staff();

    const stats = await run('holiday-reminder', OCT_2);

    expect(stats).toEqual({ due: false, admins: 0 });
    expect(await db.select().from(emailOutbox)).toHaveLength(0);
  });
});

describe('import-holidays job (GES-131, GES-132)', () => {
  const NOW = new Date('2026-08-03T10:00:00.000Z');

  /** BrasilAPI stub: `byYear` answers per year (a list, or a function returning a Response). */
  function brasilApi(byYear: Record<string, unknown[] | (() => Promise<Response>)>) {
    return vi.fn((url: string) => {
      const year = url.split('/').at(-1) ?? '';
      const answer = byYear[year];
      if (typeof answer === 'function') return answer();
      return Promise.resolve(Response.json(answer ?? []));
    }) as unknown as typeof globalThis.fetch;
  }

  const national = (date: string, name: string) => ({ date, name, type: 'national' });

  it('inserts a national date that has none yet, with source brasilapi and open', async () => {
    const fetch = brasilApi({
      '2026': [national('2026-02-16', 'Carnaval')],
      '2027': [],
    });

    const stats = await run('import-holidays', NOW, fetch);

    expect(stats).toEqual({ inserted2026: 1, inserted2027: 0 });
    const [carnaval] = await db.select().from(holidays).where(eq(holidays.date, '2026-02-16'));
    expect(carnaval).toMatchObject({
      name: 'Carnaval',
      scope: 'national',
      source: 'brasilapi',
      isClosed: false,
    });
    expect(fetch).toHaveBeenCalledWith(
      'https://brasilapi.com.br/api/feriados/v1/2026',
      expect.anything(),
    );
  });

  it('skips a date that already has a seeded national holiday and never changes is_closed', async () => {
    await db
      .update(holidays)
      .set({ isClosed: true })
      .where(and(eq(holidays.date, '2026-12-25'), eq(holidays.scope, 'national')));
    const fetch = brasilApi({
      '2026': [national('2026-12-25', 'Natal (BrasilAPI)')],
      '2027': [national('2027-01-01', 'Confraternização mundial')],
    });

    const stats = await run('import-holidays', NOW, fetch);

    expect(stats).toEqual({ inserted2026: 0, inserted2027: 0 });
    const christmas = await db.select().from(holidays).where(eq(holidays.date, '2026-12-25'));
    expect(christmas.map((h) => [h.name, h.source, h.isClosed])).toEqual([['Natal', 'seed', true]]);
    const newYear = await db.select().from(holidays).where(eq(holidays.date, '2027-01-01'));
    expect(newYear.map((h) => [h.name, h.isClosed])).toEqual([
      ['Confraternização Universal', false],
    ]);
  });

  it('keeps a failed year unchanged, still imports the other year and records the error', async () => {
    const before2027 = await db.select().from(holidays);
    const fetch = brasilApi({
      '2026': [national('2026-02-16', 'Carnaval')],
      '2027': () => Promise.resolve(new Response('boom', { status: 500 })),
    });

    await expect(run('import-holidays', NOW, fetch)).rejects.toThrow(/2027/);

    const after = await db.select().from(holidays);
    expect(after.filter((h) => h.date.startsWith('2027'))).toEqual(
      before2027.filter((h) => h.date.startsWith('2027')),
    );
    expect(after.filter((h) => h.source === 'brasilapi').map((h) => h.date)).toEqual([
      '2026-02-16',
    ]);
    const [runRow] = await db.select().from(jobRuns).where(eq(jobRuns.job, 'import-holidays'));
    expect(runRow?.status).toBe('error');
    expect(runRow?.error).toContain('2027');
    expect(runRow?.error).not.toContain('2026:');
  });

  it('treats a timeout like a failure: that year unchanged, the other imported, error recorded', async () => {
    const fetch = brasilApi({
      '2026': () => Promise.reject(new DOMException('The operation timed out', 'TimeoutError')),
      '2027': [national('2027-02-08', 'Carnaval')],
    });

    await expect(run('import-holidays', NOW, fetch)).rejects.toThrow(/2026/);

    const imported = await db
      .select({ date: holidays.date })
      .from(holidays)
      .where(eq(holidays.source, 'brasilapi'));
    expect(imported.map((h) => h.date)).toEqual(['2027-02-08']);
    const [runRow] = await db.select().from(jobRuns).where(eq(jobRuns.job, 'import-holidays'));
    expect([runRow?.status, runRow?.error?.includes('2026')]).toEqual(['error', true]);
  });

  it('treats an invalid JSON body like a failure for that year', async () => {
    const fetch = brasilApi({
      '2026': [national('2026-02-16', 'Carnaval')],
      '2027': () => Promise.resolve(new Response('<html>oops</html>', { status: 200 })),
    });

    await expect(run('import-holidays', NOW, fetch)).rejects.toThrow(/2027/);

    const imported = await db
      .select({ date: holidays.date })
      .from(holidays)
      .where(eq(holidays.source, 'brasilapi'));
    expect(imported.map((h) => h.date)).toEqual(['2026-02-16']);
    const [runRow] = await db.select().from(jobRuns).where(eq(jobRuns.job, 'import-holidays'));
    expect([runRow?.status, runRow?.error?.includes('2027')]).toEqual(['error', true]);
  });
});
