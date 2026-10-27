import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createUser } from '../../../test/factories';
import { createCreditLot } from '../../../test/factories/revenue';
import { requireTestDatabaseUrl } from '../../../test/require-test-db';
import { createDb, withTransaction, type Tx } from '../../db/client';
import { charges, creditLedger, creditLots, settings } from '../../db/schema';
import type { RequestContext } from '../../lib/audit';
import {
  applyCredits,
  availableCredit,
  expireCredits,
  grantCredit,
  refundCredit,
} from './credits.service';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

const NOW = new Date('2026-11-01T12:00:00.000Z');
const DAY = 86_400_000;
const ctx: RequestContext = {
  actorUserId: null,
  actorRole: null,
  origin: 'system',
  ip: null,
  requestId: null,
};

const inDays = (days: number) => new Date(NOW.getTime() + days * DAY);

/** A promise with its resolver, to pause one transaction at a known point. */
function gate(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = () => done();
  });
  return { promise, resolve };
}

/** Polls until some session of the test database waits on a lock (5 s at most). */
async function untilALockIsAwaited(): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const { rows } = await db.execute<{ waiting: number }>(
      sql`select count(*)::int as waiting from pg_stat_activity
          where datname = current_database() and wait_event_type = 'Lock'`,
    );
    if ((rows[0]?.waiting ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('the second use never waited on a lock');
}

async function lotsOf(userId: string) {
  return db
    .select()
    .from(creditLots)
    .where(eq(creditLots.userId, userId))
    .orderBy(creditLots.expiresAt);
}

describe('grantCredit and availableCredit (REC-105, REC-106)', () => {
  it('creates a lot expiring at now + credits.validity_days with a grant entry', async () => {
    await db.insert(settings).values({ key: 'credits.validity_days', value: 30 });
    const user = await createUser(db);
    const lot = await withTransaction(db, (tx) =>
      grantCredit(tx, ctx, { userId: user.id, amountCents: 5000, source: 'manual', now: NOW }),
    );
    expect(lot.remainingCents).toBe(5000);
    expect(lot.amountCents).toBe(5000);
    expect(lot.expiresAt.toISOString()).toBe('2026-12-01T12:00:00.000Z');
    const entries = await db.select().from(creditLedger).where(eq(creditLedger.lotId, lot.id));
    expect(entries.map((e) => [e.entryType, e.amountCents])).toEqual([['grant', 5000]]);
  });

  it('sums only unexpired lots', async () => {
    const user = await createUser(db);
    await createCreditLot(db, { userId: user.id, amountCents: 3000, expiresAt: inDays(5) });
    await createCreditLot(db, { userId: user.id, amountCents: 4000, expiresAt: inDays(-1) });
    await createCreditLot(db, { userId: user.id, amountCents: 2000, expiresAt: NOW });
    expect(await availableCredit(db, user.id, NOW)).toBe(3000);
  });
});

describe('applyCredits (REC-107, REC-108)', () => {
  it('uses 5000 + 2000 of lots expiring on day 10 and 20 for 7000, one internal charge', async () => {
    const user = await createUser(db);
    const late = await createCreditLot(db, {
      userId: user.id,
      amountCents: 5000,
      expiresAt: inDays(20),
    });
    const early = await createCreditLot(db, {
      userId: user.id,
      amountCents: 5000,
      expiresAt: inDays(10),
    });
    const result = await withTransaction(db, (tx) =>
      applyCredits(tx, ctx, {
        userId: user.id,
        amountCents: 7000,
        purpose: 'booking_deposit',
        now: NOW,
      }),
    );
    expect(result.usedCents).toBe(7000);
    const [charge] = await db
      .select()
      .from(charges)
      .where(eq(charges.id, result.chargeId ?? ''));
    expect(charge).toMatchObject({
      provider: 'internal',
      method: 'credit',
      status: 'approved',
      amountCents: 7000,
      purpose: 'booking_deposit',
    });
    const lots = await lotsOf(user.id);
    expect(lots.map((l) => [l.id, l.remainingCents])).toEqual([
      [early.id, 0],
      [late.id, 3000],
    ]);
    const uses = await db
      .select()
      .from(creditLedger)
      .where(and(eq(creditLedger.userId, user.id), eq(creditLedger.entryType, 'use')))
      .orderBy(creditLedger.id);
    expect(uses.map((u) => [u.lotId, u.amountCents, u.chargeId])).toEqual([
      [early.id, -5000, result.chargeId],
      [late.id, -2000, result.chargeId],
    ]);
  });

  it('uses min(available, payable) and creates no charge when nothing is available', async () => {
    const user = await createUser(db);
    await createCreditLot(db, { userId: user.id, amountCents: 3000, expiresAt: inDays(5) });
    const partial = await withTransaction(db, (tx) =>
      applyCredits(tx, ctx, {
        userId: user.id,
        amountCents: 9000,
        purpose: 'booking_full',
        now: NOW,
      }),
    );
    const none = await withTransaction(db, (tx) =>
      applyCredits(tx, ctx, {
        userId: user.id,
        amountCents: 9000,
        purpose: 'booking_full',
        now: NOW,
      }),
    );
    expect(partial.usedCents).toBe(3000);
    expect(none).toEqual({ usedCents: 0, chargeId: null });
    const rows = await db.select().from(charges).where(eq(charges.userId, user.id));
    expect(rows).toHaveLength(1);
  });

  it('two parallel uses of 8000 over 10000 never exceed the balance', async () => {
    const user = await createUser(db);
    await createCreditLot(db, { userId: user.id, amountCents: 6000, expiresAt: inDays(10) });
    await createCreditLot(db, { userId: user.id, amountCents: 4000, expiresAt: inDays(20) });
    const apply = (tx: Tx) =>
      applyCredits(tx, ctx, {
        userId: user.id,
        amountCents: 8000,
        purpose: 'booking_full',
        now: NOW,
      });
    // The first use keeps its transaction open after its writes until the second one is seen
    // waiting on a row lock, so the two always overlap.
    const firstUsed = gate();
    const release = gate();
    const first = withTransaction(db, async (tx) => {
      const result = await apply(tx);
      firstUsed.resolve();
      await release.promise;
      return result;
    });
    await firstUsed.promise;
    const second = withTransaction(db, apply);
    await untilALockIsAwaited();
    release.resolve();
    const results = await Promise.all([first, second]);
    expect(results.map((r) => r.usedCents)).toEqual([8000, 2000]);
    const lots = await lotsOf(user.id);
    expect(lots.every((l) => l.remainingCents === 0)).toBe(true);
  });
});

describe('refundCredit (REC-109)', () => {
  async function paidWithCredit(expiresAt: Date) {
    const user = await createUser(db);
    const lot = await createCreditLot(db, {
      userId: user.id,
      amountCents: 8000,
      expiresAt,
      source: 'reschedule_difference',
    });
    const used = await withTransaction(db, (tx) =>
      applyCredits(tx, ctx, {
        userId: user.id,
        amountCents: 8000,
        purpose: 'booking_full',
        now: NOW,
      }),
    );
    return { user, lot, chargeId: used.chargeId ?? '' };
  }

  it('returns the credit to its unexpired lot with a refund entry', async () => {
    const { user, lot, chargeId } = await paidWithCredit(inDays(30));
    const later = inDays(2);
    const result = await withTransaction(db, (tx) =>
      refundCredit(tx, ctx, { chargeId, amountCents: 8000, now: later }),
    );
    expect(result).toEqual({ refundedCents: 8000, lotIds: [lot.id] });
    const lots = await lotsOf(user.id);
    expect(lots.map((l) => l.remainingCents)).toEqual([8000]);
    const [charge] = await db.select().from(charges).where(eq(charges.id, chargeId));
    expect(charge).toMatchObject({ refundedCents: 8000, status: 'refunded' });
  });

  it('returns credit of an expired lot to a fresh lot of the same source and validity', async () => {
    await db.insert(settings).values({ key: 'credits.validity_days', value: 60 });
    const { user, lot, chargeId } = await paidWithCredit(inDays(3));
    const later = inDays(10);
    const result = await withTransaction(db, (tx) =>
      refundCredit(tx, ctx, { chargeId, amountCents: 5000, now: later }),
    );
    const fresh = (await lotsOf(user.id)).find((l) => l.id !== lot.id);
    expect(result.refundedCents).toBe(5000);
    expect(fresh).toMatchObject({
      source: 'reschedule_difference',
      amountCents: 5000,
      remainingCents: 5000,
      expiresAt: new Date(later.getTime() + 60 * DAY),
    });
    const [old] = await db.select().from(creditLots).where(eq(creditLots.id, lot.id));
    expect(old?.remainingCents).toBe(0);
    const [charge] = await db.select().from(charges).where(eq(charges.id, chargeId));
    expect(charge).toMatchObject({ refundedCents: 5000, status: 'partially_refunded' });
  });
});

describe('expireCredits (REC-113)', () => {
  it('zeroes due lots with an expiry entry and changes nothing on a second run', async () => {
    const user = await createUser(db);
    const due = await createCreditLot(db, { userId: user.id, amountCents: 3000, expiresAt: NOW });
    const kept = await createCreditLot(db, {
      userId: user.id,
      amountCents: 2000,
      expiresAt: inDays(1),
    });
    const first = await withTransaction(db, (tx) => expireCredits(tx, NOW));
    const second = await withTransaction(db, (tx) => expireCredits(tx, NOW));
    expect(first).toBe(1);
    expect(second).toBe(0);
    const lots = await lotsOf(user.id);
    expect(lots.map((l) => [l.id, l.remainingCents])).toEqual([
      [due.id, 0],
      [kept.id, 2000],
    ]);
    const expiries = await db
      .select()
      .from(creditLedger)
      .where(eq(creditLedger.entryType, 'expiry'));
    expect(expiries.map((e) => [e.lotId, e.amountCents])).toEqual([[due.id, -3000]]);
  });
});
