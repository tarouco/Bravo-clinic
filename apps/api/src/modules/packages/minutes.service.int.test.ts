import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createUser } from '../../../test/factories';
import {
  createExtraLot,
  createHourPackageCategory,
  createSubscription,
} from '../../../test/factories/revenue';
import { requireTestDatabaseUrl } from '../../../test/require-test-db';
import { createDb, withTransaction } from '../../db/client';
import { auditLog, extraMinuteLots, extraMinutesLedger, packageLedger } from '../../db/schema';
import type { RequestContext } from '../../lib/audit';
import { AppError } from '../../lib/errors';
import {
  adjustPeriod,
  createLot,
  debitLots,
  debitPeriod,
  expireLots,
  expirePeriod,
  grantPeriod,
  refundLot,
  refundPeriod,
} from './minutes.service';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

const NOW = new Date('2026-11-05T12:00:00.000Z');
const ctx: RequestContext = {
  actorUserId: null,
  actorRole: 'admin',
  origin: 'admin',
  ip: null,
  requestId: null,
};

async function subscriber(minutesBalance = 1200, status = 'active') {
  const user = await createUser(db);
  const category = await createHourPackageCategory(db);
  const { period } = await createSubscription(db, {
    userId: user.id,
    category,
    period: { minutesBalance, status },
  });
  if (period === null) throw new Error('no period');
  return { user, period };
}

/** `minutes_balance` and the ledger sum of a period, read by SQL (REC-40). */
async function balanceAndSum(periodId: string) {
  const { rows } = await pool.query<{ balance: number; total: string }>(
    `select p.minutes_balance as balance, coalesce(sum(l.minutes), 0) as total
       from subscription_periods p left join package_ledger l on l.period_id = p.id
      where p.id = $1 group by p.minutes_balance`,
    [periodId],
  );
  const row = rows[0];
  return { balance: row?.balance, sum: Number(row?.total) };
}

async function errorOf(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('expected an AppError');
}

describe('period ledger (REC-40)', () => {
  it('keeps minutes_balance equal to the ledger sum after grant, debit, refund and expiry', async () => {
    const { period } = await subscriber(0, 'paid');
    const id = period.id;
    await withTransaction(db, (tx) =>
      grantPeriod(tx, ctx, { periodId: id, minutes: 1200, now: NOW }),
    );
    expect(await balanceAndSum(id)).toEqual({ balance: 1200, sum: 1200 });
    await withTransaction(db, (tx) =>
      debitPeriod(tx, ctx, { periodId: id, minutes: 78, now: NOW }),
    );
    expect(await balanceAndSum(id)).toEqual({ balance: 1122, sum: 1122 });
    await withTransaction(db, (tx) =>
      refundPeriod(tx, ctx, { periodId: id, minutes: 78, now: NOW }),
    );
    expect(await balanceAndSum(id)).toEqual({ balance: 1200, sum: 1200 });
    const expired = await withTransaction(db, (tx) =>
      expirePeriod(tx, ctx, { periodId: id, now: NOW }),
    );
    expect(expired.expiredMinutes).toBe(1200);
    expect(await balanceAndSum(id)).toEqual({ balance: 0, sum: 0 });
    const types = await db
      .select({ type: packageLedger.entryType, minutes: packageLedger.minutes })
      .from(packageLedger)
      .where(eq(packageLedger.periodId, id))
      .orderBy(packageLedger.id);
    expect(types).toEqual([
      { type: 'period_grant', minutes: 1200 },
      { type: 'debit', minutes: -78 },
      { type: 'refund', minutes: 78 },
      { type: 'expiry', minutes: -1200 },
    ]);
  });

  it('rejects a debit beyond the balance with INSUFFICIENT_BALANCE and writes nothing', async () => {
    const { period } = await subscriber(40);
    const error = await errorOf(
      withTransaction(db, (tx) =>
        debitPeriod(tx, ctx, { periodId: period.id, minutes: 78, now: NOW }),
      ),
    );
    expect(error.status).toBe(422);
    expect(error.code).toBe('INSUFFICIENT_BALANCE');
    expect(error.details).toEqual([
      expect.objectContaining({ path: 'requiredMinutes', value: 78 }),
      expect.objectContaining({ path: 'availableMinutes', value: 40 }),
    ]);
    expect(await balanceAndSum(period.id)).toEqual({ balance: 40, sum: 40 });
  });

  it('two parallel debits of 700 on 1200: one succeeds, the other is INSUFFICIENT_BALANCE (REC-32)', async () => {
    const { period } = await subscriber(1200);
    const debit = () =>
      withTransaction(db, (tx) =>
        debitPeriod(tx, ctx, { periodId: period.id, minutes: 700, now: NOW }),
      );
    const results = await Promise.allSettled([debit(), debit()]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      code: 'INSUFFICIENT_BALANCE',
    });
    expect(await balanceAndSum(period.id)).toEqual({ balance: 500, sum: 500 });
  });
});

describe('adjustPeriod (REC-43, REC-44)', () => {
  it('writes a manual_adjustment of +30 and audits package_ledger.adjust with before/after', async () => {
    const { period } = await subscriber(750);
    const after = await withTransaction(db, (tx) =>
      adjustPeriod(tx, ctx, {
        periodId: period.id,
        minutes: 30,
        justification: 'Cortesia de boas-vindas',
        now: NOW,
      }),
    );
    expect(after.minutesBalance).toBe(780);
    const [entry] = await db
      .select()
      .from(packageLedger)
      .where(eq(packageLedger.entryType, 'manual_adjustment'));
    expect(entry).toMatchObject({ minutes: 30, periodId: period.id });
    const [row] = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'package_ledger.adjust'));
    expect(row).toMatchObject({
      entityId: period.id,
      justification: 'Cortesia de boas-vindas',
      before: { minutesBalance: 750 },
      after: { minutesBalance: 780, minutes: 30 },
    });
    expect(await balanceAndSum(period.id)).toEqual({ balance: 780, sum: 780 });
  });

  it('rejects an adjustment that makes the balance negative with INSUFFICIENT_BALANCE, no audit', async () => {
    const { period } = await subscriber(20);
    const error = await errorOf(
      withTransaction(db, (tx) =>
        adjustPeriod(tx, ctx, {
          periodId: period.id,
          minutes: -30,
          justification: 'Correção',
          now: NOW,
        }),
      ),
    );
    expect(error.code).toBe('INSUFFICIENT_BALANCE');
    expect(await db.select().from(auditLog)).toHaveLength(0);
    expect(await balanceAndSum(period.id)).toEqual({ balance: 20, sum: 20 });
  });

  it('only adjusts an active period', async () => {
    const { period } = await subscriber(1200, 'paid');
    const error = await errorOf(
      withTransaction(db, (tx) =>
        adjustPeriod(tx, ctx, {
          periodId: period.id,
          minutes: 30,
          justification: 'Correção',
          now: NOW,
        }),
      ),
    );
    expect(error.code).toBe('INVALID_TRANSITION');
  });
});

describe('extra-minute lots', () => {
  async function remaining(lotId: string) {
    const [lot] = await db.select().from(extraMinuteLots).where(eq(extraMinuteLots.id, lotId));
    return lot?.minutesRemaining;
  }

  it('creates a lot with its grant entry', async () => {
    const user = await createUser(db);
    const expiresAt = new Date('2027-02-03T12:00:00.000Z');
    const lot = await withTransaction(db, (tx) =>
      createLot(tx, ctx, {
        userId: user.id,
        minutes: 300,
        source: 'purchase',
        expiresAt,
        now: NOW,
      }),
    );
    expect(lot).toMatchObject({ minutesGranted: 300, minutesRemaining: 300, expiresAt });
    const entries = await db
      .select()
      .from(extraMinutesLedger)
      .where(eq(extraMinutesLedger.lotId, lot.id));
    expect(entries.map((e) => [e.entryType, e.minutes])).toEqual([['grant', 300]]);
  });

  it('debits the allocated parts and refunds a lot, keeping remaining = ledger sum', async () => {
    const user = await createUser(db);
    const a = await createExtraLot(db, { userId: user.id, minutes: 60 });
    const b = await createExtraLot(db, { userId: user.id, minutes: 300 });
    await withTransaction(db, (tx) =>
      debitLots(tx, ctx, {
        parts: [
          { lotId: a.id, minutes: 60 },
          { lotId: b.id, minutes: 18 },
        ],
        now: NOW,
      }),
    );
    expect([await remaining(a.id), await remaining(b.id)]).toEqual([0, 282]);
    await withTransaction(db, (tx) => refundLot(tx, ctx, { lotId: b.id, minutes: 18, now: NOW }));
    expect(await remaining(b.id)).toBe(300);
    const { rows } = await pool.query<{ lot_id: string; total: string }>(
      `select lot_id, sum(minutes) as total from extra_minutes_ledger where user_id = $1 group by lot_id`,
      [user.id],
    );
    const sums = Object.fromEntries(rows.map((r) => [r.lot_id, Number(r.total)]));
    expect(sums).toEqual({ [a.id]: 0, [b.id]: 300 });
  });

  it('rejects a lot debit beyond what the lot holds and writes nothing', async () => {
    const user = await createUser(db);
    const lot = await createExtraLot(db, { userId: user.id, minutes: 30 });
    const error = await errorOf(
      withTransaction(db, (tx) =>
        debitLots(tx, ctx, { parts: [{ lotId: lot.id, minutes: 40 }], now: NOW }),
      ),
    );
    expect(error.code).toBe('INSUFFICIENT_BALANCE');
    expect(await remaining(lot.id)).toBe(30);
  });

  it('expires lots with expires_at ≤ now with an expiry entry; a second run changes 0 rows (REC-67)', async () => {
    const user = await createUser(db);
    const due = await createExtraLot(db, { userId: user.id, minutes: 120, expiresAt: NOW });
    const kept = await createExtraLot(db, {
      userId: user.id,
      minutes: 60,
      expiresAt: new Date(NOW.getTime() + 60_000),
    });
    const first = await withTransaction(db, (tx) => expireLots(tx, ctx, NOW));
    const second = await withTransaction(db, (tx) => expireLots(tx, ctx, NOW));
    expect([first, second]).toEqual([1, 0]);
    expect([await remaining(due.id), await remaining(kept.id)]).toEqual([0, 60]);
    const expiries = await db
      .select({ lotId: extraMinutesLedger.lotId, minutes: extraMinutesLedger.minutes })
      .from(extraMinutesLedger)
      .where(eq(extraMinutesLedger.entryType, 'expiry'));
    expect(expiries).toEqual([{ lotId: due.id, minutes: -120 }]);
  });
});
