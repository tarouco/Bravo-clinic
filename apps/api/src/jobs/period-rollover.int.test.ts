import { and, eq, like } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTenant } from '../../test/booking-helpers';
import { createCreditLot, createExtraLot, createSubscription } from '../../test/factories/revenue';
import { forbiddenFetch, testEnv } from '../../test/http';
import { requireTestDatabaseUrl } from '../../test/require-test-db';
import { createDb, withTransaction } from '../db/client';
import {
  bookingCategories,
  closedDays,
  creditLedger,
  emailOutbox,
  creditLots,
  extraMinuteLots,
  extraMinutesLedger,
  packageLedger,
  subscriptionPeriods,
  subscriptions,
} from '../db/schema';
import { runSeed } from '../db/seed';
import { buildRegistry } from '../extensions';
import { createRenewalPeriod } from '../modules/subscriptions/period.service';
import { periodRollover } from './period-rollover';
import { suspensions } from './suspensions';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

const NOW = new Date('2026-10-26T12:00:00.000Z');
// 2026-12-02 03:00 BRT: base date of the second period of a 2026-11-02 subscription.
const STARTS_ON = new Date('2026-12-02T06:00:00.000Z');
const GRACE_END = new Date('2026-12-09T06:00:00.000Z');
const deps = (now: Date) => ({
  db,
  env: testEnv(),
  fetch: forbiddenFetch,
  now: () => now,
  registry: buildRegistry(),
});
const rollover = (now: Date) => periodRollover(deps(now), now);
const suspend = (now: Date) => suspensions(deps(now), now);

beforeEach(async () => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  await runSeed(db);
});

const seeded = async (name: string) => {
  const [row] = await db.select().from(bookingCategories).where(eq(bookingCategories.name, name));
  if (row === undefined) throw new Error(`no seeded category ${name}`);
  return row;
};

/** Pacote 20h from 2026-11-02 with 300 min left and its renewal period in `renewalStatus`. */
async function withRenewal(renewalStatus: 'paid' | 'awaiting_payment') {
  const { user } = await createTenant(db, { now: NOW });
  const category = await seeded('Pacote 20h mensal');
  const { subscription, period } = await createSubscription(db, {
    userId: user.id,
    category,
    period: { status: 'active', minutesBalance: 300 },
  });
  const renewal = await withTransaction(db, (tx) => createRenewalPeriod(tx, subscription.id, NOW));
  if (renewalStatus === 'paid') {
    await db
      .update(subscriptionPeriods)
      .set({ status: 'paid', paidAt: NOW })
      .where(eq(subscriptionPeriods.id, renewal?.id ?? ''));
  }
  return { user, subscription, period, renewal };
}

const stateOf = async (subscriptionId: string) => {
  const [subscription] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.id, subscriptionId));
  const periods = await db
    .select()
    .from(subscriptionPeriods)
    .where(eq(subscriptionPeriods.subscriptionId, subscriptionId))
    .orderBy(subscriptionPeriods.seq);
  return {
    status: subscription?.status,
    periods: periods.map((p) => [p.seq, p.status, p.minutesBalance]),
  };
};

describe('period-rollover and suspensions on 2026-12-02 (REC-17, REC-53, REC-54)', () => {
  it('paid seq 2 activates with its grant; seq 1 closes with an expiry of the minutes left', async () => {
    const { subscription, period } = await withRenewal('paid');
    expect(await rollover(STARTS_ON)).toMatchObject({ closed: 1, activated: 1 });
    expect(await stateOf(subscription.id)).toEqual({
      status: 'active',
      periods: [
        [1, 'closed', 0],
        [2, 'active', 1200],
      ],
    });
    const [expiry] = await db
      .select()
      .from(packageLedger)
      .where(
        and(eq(packageLedger.periodId, period?.id ?? ''), eq(packageLedger.entryType, 'expiry')),
      );
    expect(expiry?.minutes).toBe(-300);
  });

  it('nothing happens the day before', async () => {
    const { subscription } = await withRenewal('paid');
    expect(await rollover(new Date('2026-12-01T06:00:00.000Z'))).toMatchObject({
      closed: 0,
      activated: 0,
    });
    expect((await stateOf(subscription.id)).periods).toEqual([
      [1, 'active', 300],
      [2, 'paid', 0],
    ]);
  });

  it('an unpaid seq 2 suspends the subscription; the period stays awaiting payment', async () => {
    const { subscription } = await withRenewal('awaiting_payment');
    await rollover(STARTS_ON);
    expect(await suspend(STARTS_ON)).toEqual({ suspended: 1, ended: 0 });
    expect(await stateOf(subscription.id)).toEqual({
      status: 'suspended',
      periods: [
        [1, 'closed', 0],
        [2, 'awaiting_payment', 0],
      ],
    });
  });

  it('still unpaid on 2026-12-09 the subscription ends and the period fails (REC-57)', async () => {
    const { subscription } = await withRenewal('awaiting_payment');
    await suspend(STARTS_ON);
    expect(await suspend(new Date('2026-12-08T06:00:00.000Z'))).toEqual({
      suspended: 0,
      ended: 0,
    });
    expect(await suspend(GRACE_END)).toEqual({ suspended: 0, ended: 1 });
    expect((await stateOf(subscription.id)).status).toBe('ended');
    expect((await stateOf(subscription.id)).periods[1]?.[1]).toBe('failed');
  });

  it('a first period paid ahead activates on its base date (REC-17)', async () => {
    const { user } = await createTenant(db, { now: NOW });
    const category = await seeded('Pacote 20h mensal');
    const { subscription } = await createSubscription(db, {
      userId: user.id,
      category,
      period: { status: 'paid', minutesBalance: 0 },
    });
    await rollover(new Date('2026-11-02T06:00:00.000Z'));
    expect((await stateOf(subscription.id)).periods).toEqual([[1, 'active', 1200]]);
  });
});

describe('effects of the transitions', () => {
  it('activation by the rollover compensates a clinic closure already in the period (REC-102)', async () => {
    const { user } = await withRenewal('paid');
    await db.insert(closedDays).values({ date: '2026-12-10', roomId: null });
    await rollover(STARTS_ON);
    const lots = await db.select().from(extraMinuteLots).where(eq(extraMinuteLots.userId, user.id));
    expect(lots.map((l) => [l.source, l.minutesGranted])).toEqual([
      ['closed_day_compensation', 40],
    ]);
  });

  it('suspension and end e-mails are queued once across re-runs', async () => {
    const { subscription } = await withRenewal('awaiting_payment');
    await suspend(STARTS_ON);
    await suspend(STARTS_ON);
    await suspend(GRACE_END);
    await suspend(GRACE_END);
    const mails = await db
      .select({ template: emailOutbox.template })
      .from(emailOutbox)
      .where(like(emailOutbox.dedupeKey, `subscription.%`));
    expect(mails.map((m) => m.template).sort()).toEqual([
      'subscription.ended',
      'subscription.suspended',
    ]);
    expect((await stateOf(subscription.id)).status).toBe('ended');
  });
});

describe('order independence and re-runs (REC-59 stats, design "Jobs")', () => {
  it('running both jobs in either order gives the same final state', async () => {
    const paidA = await withRenewal('paid');
    const unpaidA = await withRenewal('awaiting_payment');
    await rollover(STARTS_ON);
    await suspend(STARTS_ON);
    const paidB = await withRenewal('paid');
    const unpaidB = await withRenewal('awaiting_payment');
    await suspend(STARTS_ON);
    await rollover(STARTS_ON);
    expect(await stateOf(paidB.subscription.id)).toEqual(await stateOf(paidA.subscription.id));
    expect(await stateOf(unpaidB.subscription.id)).toEqual(await stateOf(unpaidA.subscription.id));
  });

  it('a re-run changes 0 rows', async () => {
    await withRenewal('paid');
    await withRenewal('awaiting_payment');
    await rollover(STARTS_ON);
    await suspend(STARTS_ON);
    expect(await rollover(STARTS_ON)).toEqual({
      closed: 0,
      activated: 0,
      lotsExpired: 0,
      creditsExpired: 0,
    });
    expect(await suspend(STARTS_ON)).toEqual({ suspended: 0, ended: 0 });
  });
});

describe('expiry of lots and credits (REC-67, REC-113)', () => {
  it('zeroes expired extra lots and credit lots with expiry entries, once', async () => {
    const { user } = await createTenant(db, { now: NOW });
    const lot = await createExtraLot(db, {
      userId: user.id,
      minutes: 120,
      expiresAt: new Date('2026-12-01T12:00:00Z'),
    });
    const keep = await createExtraLot(db, { userId: user.id, minutes: 60 });
    const credit = await createCreditLot(db, {
      userId: user.id,
      amountCents: 3000,
      expiresAt: new Date('2026-12-01T12:00:00Z'),
    });
    expect(await rollover(STARTS_ON)).toMatchObject({ lotsExpired: 1, creditsExpired: 1 });
    const [expiredLot] = await db
      .select()
      .from(extraMinuteLots)
      .where(eq(extraMinuteLots.id, lot.id));
    expect(expiredLot?.minutesRemaining).toBe(0);
    const [keptLot] = await db
      .select()
      .from(extraMinuteLots)
      .where(eq(extraMinuteLots.id, keep.id));
    expect(keptLot?.minutesRemaining).toBe(60);
    const [lotExpiry] = await db
      .select()
      .from(extraMinutesLedger)
      .where(and(eq(extraMinutesLedger.lotId, lot.id), eq(extraMinutesLedger.entryType, 'expiry')));
    expect(lotExpiry?.minutes).toBe(-120);
    const [expiredCredit] = await db.select().from(creditLots).where(eq(creditLots.id, credit.id));
    expect(expiredCredit?.remainingCents).toBe(0);
    const [creditExpiry] = await db
      .select()
      .from(creditLedger)
      .where(and(eq(creditLedger.lotId, credit.id), eq(creditLedger.entryType, 'expiry')));
    expect(creditExpiry?.amountCents).toBe(-3000);
    expect(await rollover(STARTS_ON)).toMatchObject({ lotsExpired: 0, creditsExpired: 0 });
  });
});
