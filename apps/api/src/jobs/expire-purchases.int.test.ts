import { randomUUID } from 'node:crypto';
import type { SubscriptionPurchaseInput } from '@bravo/core';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTenant, seededRoom } from '../../test/booking-helpers';
import { createCoupon, createCreditLot, createSubscription } from '../../test/factories/revenue';
import { forbiddenFetch, testEnv } from '../../test/http';
import { requireTestDatabaseUrl } from '../../test/require-test-db';
import { createApp } from '../app';
import { createDb } from '../db/client';
import {
  bookingCategories,
  bookings,
  charges,
  couponUses,
  coupons,
  creditLots,
  extraHoursPurchases,
  jobRuns,
  roomOccupancy,
  subscriptionPeriods,
  subscriptions,
} from '../db/schema';
import { runSeed } from '../db/seed';
import { buildRegistry } from '../extensions';
import { purchaseExtraHours } from '../modules/extra-hours/extra-hours.service';
import { purchaseSubscription } from '../modules/subscriptions/purchase.service';
import { runCli } from './cli';
import { expirePurchases } from './expire-purchases';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

// Monday 2026-10-26 09:00 BRT; holds of 15 minutes end at 12:15Z.
const NOW = new Date('2026-10-26T12:00:00.000Z');
const AFTER_HOLD = new Date('2026-10-26T12:20:00.000Z');
const deps = (now = NOW) => ({
  db,
  env: testEnv(),
  fetch: forbiddenFetch,
  now: () => now,
  registry: buildRegistry(),
});
const SLOW = 240_000;

beforeEach(async () => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  await runSeed(db);
});

const seeded = async (name: string) => {
  const [row] = await db.select().from(bookingCategories).where(eq(bookingCategories.name, name));
  if (row === undefined) throw new Error(`no seeded category ${name}`);
  return row;
};

async function buyFixedWithCouponAndCredits() {
  const { user } = await createTenant(db, { now: NOW });
  const meio = await seeded('Meio turno mensal');
  const room = await seededRoom(db);
  const coupon = await createCoupon(db, { code: 'TURNO10', appliesTo: 'packages', maxUses: 5 });
  await createCreditLot(db, { userId: user.id, amountCents: 10_000 });
  const result = await purchaseSubscription(
    deps(),
    { actorUserId: user.id, actorRole: 'tenant', origin: 'app', ip: null, requestId: null },
    { ip: null, userAgent: null },
    {
      userId: user.id,
      source: 'app',
      body: {
        categoryId: meio.id,
        roomId: room.id,
        baseOn: '2026-11-02',
        couponCode: 'TURNO10',
        useCredits: true,
        paymentMethod: 'pix',
        acceptTerms: true,
        acceptRecurring: true,
      } satisfies SubscriptionPurchaseInput,
    },
  );
  return { user, coupon, room, ...result };
}

describe('expire-purchases (REC-18, REC-70)', () => {
  it(
    'an unpaid fixed subscription past its hold expires with everything it held released',
    async () => {
      const { user, coupon, room, subscriptionId, charge } = await buyFixedWithCouponAndCredits();
      expect(await expirePurchases(deps(AFTER_HOLD), AFTER_HOLD)).toEqual({
        subscriptionsExpired: 1,
        purchasesCancelled: 0,
      });
      const [subscription] = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.id, subscriptionId));
      expect(subscription?.status).toBe('expired');
      const [period] = await db
        .select()
        .from(subscriptionPeriods)
        .where(eq(subscriptionPeriods.subscriptionId, subscriptionId));
      expect(period?.status).toBe('cancelled');
      const occurrences = await db
        .select()
        .from(bookings)
        .where(eq(bookings.subscriptionId, subscriptionId));
      expect(occurrences).toHaveLength(22);
      expect(new Set(occurrences.map((b) => b.status))).toEqual(new Set(['expired']));
      expect(
        await db
          .select()
          .from(roomOccupancy)
          .where(and(eq(roomOccupancy.roomId, room.id), eq(roomOccupancy.active, true))),
      ).toHaveLength(0);
      const [use] = await db.select().from(couponUses).where(eq(couponUses.couponId, coupon.id));
      expect(use?.status).toBe('released');
      const [counter] = await db.select().from(coupons).where(eq(coupons.id, coupon.id));
      expect(counter?.usesCount).toBe(0);
      const lots = await db.select().from(creditLots).where(eq(creditLots.userId, user.id));
      expect(lots.reduce((sum, l) => sum + l.remainingCents, 0)).toBe(10_000);
      const [pending] = await db
        .select()
        .from(charges)
        .where(eq(charges.id, charge?.id ?? ''));
      expect(pending?.status).toBe('cancelled');
    },
    SLOW,
  );

  it(
    'leaves a hold that has not passed and changes nothing on a re-run',
    async () => {
      const { subscriptionId } = await buyFixedWithCouponAndCredits();
      expect(await expirePurchases(deps(), NOW)).toEqual({
        subscriptionsExpired: 0,
        purchasesCancelled: 0,
      });
      const [before] = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.id, subscriptionId));
      expect(before?.status).toBe('awaiting_payment');
      await expirePurchases(deps(AFTER_HOLD), AFTER_HOLD);
      expect(await expirePurchases(deps(AFTER_HOLD), AFTER_HOLD)).toEqual({
        subscriptionsExpired: 0,
        purchasesCancelled: 0,
      });
    },
    SLOW,
  );

  it('an unpaid extra-hours purchase past its hold is cancelled with its charge', async () => {
    const { user } = await createTenant(db, { now: NOW });
    await createSubscription(db, {
      userId: user.id,
      category: await seeded('Pacote 20h mensal'),
      baseOn: '2026-10-12',
      period: { status: 'active', minutesBalance: 600 },
    });
    const { purchase, charge } = await purchaseExtraHours(
      deps(),
      { actorUserId: user.id, actorRole: 'tenant', origin: 'app', ip: null, requestId: null },
      { userId: user.id, body: { hours: 2, paymentMethod: 'pix' } },
    );
    expect(await expirePurchases(deps(AFTER_HOLD), AFTER_HOLD)).toEqual({
      subscriptionsExpired: 0,
      purchasesCancelled: 1,
    });
    const [row] = await db
      .select()
      .from(extraHoursPurchases)
      .where(eq(extraHoursPurchases.id, purchase.id));
    expect(row?.status).toBe('cancelled');
    const [after] = await db
      .select()
      .from(charges)
      .where(eq(charges.id, charge?.id ?? ''));
    expect(after?.status).toBe('cancelled');
  });
});

describe('receita job routes and the CLI (REC-59)', () => {
  const names = ['renewals', 'period-rollover', 'suspensions', 'expire-purchases'];
  const app = (verified: boolean) =>
    createApp({
      ...deps(),
      verifyTrigger: () => Promise.resolve(verified ? { invocationId: randomUUID() } : null),
    });

  it('POST /jobs/<name> without a trigger delivery answers 401 and runs nothing', async () => {
    for (const name of names) {
      const res = await app(false).request(`/jobs/${name}`, { method: 'POST', body: '{}' });
      expect(res.status).toBe(401);
    }
    expect(await db.select().from(jobRuns)).toHaveLength(0);
  });

  it('with a verified delivery each job answers 200 and writes a job_runs row with stats', async () => {
    for (const name of names) {
      const res = await app(true).request(`/jobs/${name}`, { method: 'POST', body: '{}' });
      expect(res.status).toBe(200);
      expect(((await res.json()) as { job: string }).job).toBe(name);
    }
    const rows = await db.select().from(jobRuns);
    expect(rows.map((r) => [r.job, r.status]).sort()).toEqual(names.map((n) => [n, 'ok']).sort());
    expect(rows.find((r) => r.job === 'expire-purchases')?.stats).toEqual({
      subscriptionsExpired: 0,
      purchasesCancelled: 0,
    });
  });

  it('the CLI runs renewals at --now with a job_runs row', async () => {
    const stats = await runCli(
      ['renewals', '--now=2026-11-30T06:00:00Z'],
      { NODE_ENV: 'test' },
      {
        db,
        env: testEnv(),
        fetch: forbiddenFetch,
        registry: buildRegistry(),
      },
    );
    expect(stats).toMatchObject({ renewalsCreated: 0, charges: 0 });
    const [run] = await db.select().from(jobRuns).where(eq(jobRuns.job, 'renewals'));
    expect(run?.startedAt.toISOString()).toBe('2026-11-30T06:00:00.000Z');
    expect(run?.invocationId).toMatch(/^cli:/);
  });
});
