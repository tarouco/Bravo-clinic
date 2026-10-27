import { readFileSync } from 'node:fs';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createUser } from '../../test/factories';
import {
  createCoupon,
  createCouponUse,
  createCreditLot,
  createExtraLot,
  createFixedCategory,
  createHourPackageCategory,
  createSubscription,
} from '../../test/factories/revenue';
import { requireTestDatabaseUrl } from '../../test/require-test-db';
import { createDb } from './client';
import {
  closedDayCompensations,
  closedDays,
  couponUses,
  creditLots,
  extraMinuteLots,
  rooms,
  slotDiscounts,
  subscriptionPeriods,
} from './schema';
import { runSeed } from './seed';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await runSeed(db);
});

/** SQLSTATE and message of a rejected statement (drizzle wraps the pg error in `cause`). */
async function failure(
  promise: Promise<unknown>,
): Promise<{ code: string | undefined; message: string }> {
  try {
    await promise;
  } catch (error) {
    const err = error as {
      code?: string;
      message: string;
      cause?: { code?: string; message: string };
    };
    return { code: err.cause?.code ?? err.code, message: err.cause?.message ?? err.message };
  }
  throw new Error('statement was accepted');
}

async function roomIds(): Promise<[string, string]> {
  const rows = await db.select({ id: rooms.id }).from(rooms).orderBy(rooms.displayOrder);
  const [first, second] = rows;
  if (first === undefined || second === undefined)
    throw new Error('seed created fewer than 2 rooms');
  return [first.id, second.id];
}

async function hourSubscriber() {
  const user = await createUser(db);
  const category = await createHourPackageCategory(db);
  const { subscription, period } = await createSubscription(db, { userId: user.id, category });
  if (period === null) throw new Error('no period');
  return { user, category, subscription, period };
}

describe('receita migrations', () => {
  it('registers 0004_receita and 0005_receita_constraints after the nucleo migrations', () => {
    const journal = JSON.parse(
      readFileSync(new URL('../../drizzle/meta/_journal.json', import.meta.url), 'utf8'),
    ) as { entries: { idx: number; tag: string }[] };
    const tags = journal.entries.map((e) => e.tag);
    expect(tags.indexOf('0004_receita')).toBe(tags.indexOf('0003_nucleo_constraints') + 1);
    expect(tags.indexOf('0005_receita_constraints')).toBe(tags.indexOf('0004_receita') + 1);
  });

  it('creates every receita table', async () => {
    const { rows } = await pool.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public'`,
    );
    const present = rows.map((r) => r.table_name);
    for (const table of [
      'subscriptions',
      'subscription_periods',
      'package_ledger',
      'extra_hours_purchases',
      'extra_minute_lots',
      'extra_minutes_ledger',
      'credit_lots',
      'credit_ledger',
      'coupons',
      'coupon_uses',
      'slot_discounts',
      'closed_day_compensations',
    ]) {
      expect(present).toContain(table);
    }
  });
});

describe('append-only ledgers (REC-39)', () => {
  it('rejects UPDATE and DELETE on package_ledger', async () => {
    const { period } = await hourSubscriber();
    const update = await failure(
      db.execute(sql`update package_ledger set minutes = 1 where period_id = ${period.id}`),
    );
    const remove = await failure(
      db.execute(sql`delete from package_ledger where period_id = ${period.id}`),
    );
    expect(update.message).toContain('append_only_table');
    expect(remove.message).toContain('append_only_table');
  });

  it('rejects UPDATE and DELETE on extra_minutes_ledger', async () => {
    const user = await createUser(db);
    const lot = await createExtraLot(db, { userId: user.id });
    const update = await failure(
      db.execute(sql`update extra_minutes_ledger set minutes = 1 where lot_id = ${lot.id}`),
    );
    const remove = await failure(
      db.execute(sql`delete from extra_minutes_ledger where lot_id = ${lot.id}`),
    );
    expect(update.message).toContain('append_only_table');
    expect(remove.message).toContain('append_only_table');
  });

  it('rejects UPDATE and DELETE on credit_ledger', async () => {
    const user = await createUser(db);
    const lot = await createCreditLot(db, { userId: user.id });
    const update = await failure(
      db.execute(sql`update credit_ledger set amount_cents = 1 where lot_id = ${lot.id}`),
    );
    const remove = await failure(
      db.execute(sql`delete from credit_ledger where lot_id = ${lot.id}`),
    );
    expect(update.message).toContain('append_only_table');
    expect(remove.message).toContain('append_only_table');
  });
});

describe('one hour package per tenant (REC-12)', () => {
  it('rejects a second non-terminal hour package with 23505', async () => {
    const { user, category } = await hourSubscriber();
    const second = await failure(
      createSubscription(db, {
        userId: user.id,
        category,
        status: 'awaiting_payment',
        period: null,
      }),
    );
    expect(second.code).toBe('23505');
  });

  it('accepts a new hour package after the previous one ended, and several fixed schedules', async () => {
    const user = await createUser(db);
    const hour = await createHourPackageCategory(db);
    await createSubscription(db, {
      userId: user.id,
      category: hour,
      status: 'ended',
      period: null,
    });
    await createSubscription(db, {
      userId: user.id,
      category: hour,
      status: 'active',
      period: null,
    });
    const [roomA, roomB] = await roomIds();
    const fixed = await createFixedCategory(db);
    await createSubscription(db, { userId: user.id, category: fixed, roomId: roomA, period: null });
    const again = await createSubscription(db, {
      userId: user.id,
      category: fixed,
      roomId: roomB,
      period: null,
    });
    expect(again.subscription.status).toBe('active');
  });
});

describe('non-negative balances (REC-40)', () => {
  it('rejects minutes_balance = -1 with 23514', async () => {
    const { period } = await hourSubscriber();
    const result = await failure(
      db
        .update(subscriptionPeriods)
        .set({ minutesBalance: -1 })
        .where(eq(subscriptionPeriods.id, period.id)),
    );
    expect(result.code).toBe('23514');
  });

  it('rejects minutes_remaining = -1 and remaining_cents = -1 with 23514', async () => {
    const user = await createUser(db);
    const lot = await createExtraLot(db, { userId: user.id });
    const credit = await createCreditLot(db, { userId: user.id });
    const minutes = await failure(
      db
        .update(extraMinuteLots)
        .set({ minutesRemaining: -1 })
        .where(eq(extraMinuteLots.id, lot.id)),
    );
    const cents = await failure(
      db.update(creditLots).set({ remainingCents: -1 }).where(eq(creditLots.id, credit.id)),
    );
    expect(minutes.code).toBe('23514');
    expect(cents.code).toBe('23514');
  });
});

describe('slot discount exclusion (REC-135)', () => {
  const insert = (roomId: string, from: string, to: string) =>
    db.insert(slotDiscounts).values({ roomId, period: `[${from},${to})`, percent: 15 });

  it('rejects an overlapping active discount in the same room with 23P01', async () => {
    const [roomA] = await roomIds();
    await insert(roomA, '2026-11-03T22:00:00.000Z', '2026-11-04T01:00:00.000Z');
    const result = await failure(
      insert(roomA, '2026-11-03T23:00:00.000Z', '2026-11-04T00:00:00.000Z'),
    );
    expect(result.code).toBe('23P01');
  });

  it('accepts the same interval in another room and over a removed discount', async () => {
    const [roomA, roomB] = await roomIds();
    const [first] = await insert(
      roomA,
      '2026-11-03T22:00:00.000Z',
      '2026-11-04T01:00:00.000Z',
    ).returning();
    await insert(roomB, '2026-11-03T22:00:00.000Z', '2026-11-04T01:00:00.000Z');
    await db
      .update(slotDiscounts)
      .set({ removedAt: new Date() })
      .where(eq(slotDiscounts.id, first?.id ?? ''));
    await insert(roomA, '2026-11-03T22:00:00.000Z', '2026-11-04T01:00:00.000Z');
    const { rows } = await pool.query(`select 1 from slot_discounts`);
    expect(rows).toHaveLength(3);
  });
});

describe('closed-day compensation uniqueness (REC-104)', () => {
  it('rejects a duplicate (closed_day, subscription) with 23505', async () => {
    const { subscription, period } = await hourSubscriber();
    const [day] = await db.insert(closedDays).values({ date: '2026-11-20' }).returning();
    if (day === undefined) throw new Error('no closed day');
    const row = {
      closedDayId: day.id,
      subscriptionId: subscription.id,
      periodId: period.id,
      kind: 'minutes',
      minutes: 40,
    };
    await db.insert(closedDayCompensations).values(row);
    const result = await failure(db.insert(closedDayCompensations).values(row));
    expect(result.code).toBe('23505');
  });
});

describe('coupon use transitions', () => {
  async function use(status = 'reserved') {
    const user = await createUser(db);
    const coupon = await createCoupon(db);
    return createCouponUse(db, { couponId: coupon.id, userId: user.id, status });
  }
  const setStatus = (id: string, status: string) =>
    db.update(couponUses).set({ status }).where(eq(couponUses.id, id));

  it('accepts reserved → consumed and reserved → released', async () => {
    const a = await use();
    const b = await use();
    await setStatus(a.id, 'consumed');
    await setStatus(b.id, 'released');
    const rows = await db.select({ status: couponUses.status }).from(couponUses);
    expect(rows.map((r) => r.status).sort()).toEqual(['consumed', 'released']);
  });

  it('rejects consumed → reserved, released → consumed and DELETE', async () => {
    const consumed = await use('consumed');
    const released = await use('released');
    const back = await failure(setStatus(consumed.id, 'reserved'));
    const again = await failure(setStatus(released.id, 'consumed'));
    const remove = await failure(db.delete(couponUses).where(eq(couponUses.id, consumed.id)));
    expect(back.message).toContain('invalid_coupon_use_transition');
    expect(again.message).toContain('invalid_coupon_use_transition');
    expect(remove.message).toContain('append_only_table');
  });

  it('rejects changing the discount of a reserved use', async () => {
    const reserved = await use();
    const result = await failure(
      db.update(couponUses).set({ discountCents: 1 }).where(eq(couponUses.id, reserved.id)),
    );
    expect(result.message).toContain('invalid_coupon_use_transition');
  });
});
