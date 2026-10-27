import { randomUUID } from 'node:crypto';
import { localToUtc } from '@bravo/core';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTenant, seededRoom } from '../../../test/booking-helpers';
import { createBooking } from '../../../test/factories';
import {
  createCreditLot,
  createExtraLot,
  createSubscription,
} from '../../../test/factories/revenue';
import { forbiddenFetch, testEnv } from '../../../test/http';
import { requireTestDatabaseUrl } from '../../../test/require-test-db';
import { createDb, withTransaction } from '../../db/client';
import {
  auditLog,
  bookingCategories,
  bookings,
  charges,
  emailOutbox,
  packageLedger,
  refunds,
  roomOccupancy,
  subscriptionPeriods,
  subscriptions,
} from '../../db/schema';
import { runSeed } from '../../db/seed';
import { buildRegistry } from '../../extensions';
import type { RequestContext } from '../../lib/audit';
import { AppError } from '../../lib/errors';
import { newAfterCommit } from '../booking/effects';
import { applyProviderStatus } from '../payments/payment-effects.service';
import {
  cancelPreview,
  cancelSubscription,
  endAfterGrace,
  payPending,
  suspendDue,
} from './cancel.service';
import { activatePeriod, createRenewalPeriod } from './period.service';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

// Monday 2026-10-26 09:00 BRT.
const NOW = new Date('2026-10-26T12:00:00.000Z');
const STARTS_ON = new Date('2026-12-02T06:00:00.000Z');
const deps = (now = NOW) => ({
  db,
  env: testEnv(),
  fetch: forbiddenFetch,
  now: () => now,
  registry: buildRegistry(),
});
const job: RequestContext = {
  actorUserId: null,
  actorRole: null,
  origin: 'job',
  ip: null,
  requestId: null,
};
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

async function errorOf(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('expected an AppError');
}

const subscriptionOf = async (id: string) =>
  (await db.select().from(subscriptions).where(eq(subscriptions.id, id)))[0];
const periodsOf = (subscriptionId: string) =>
  db
    .select()
    .from(subscriptionPeriods)
    .where(eq(subscriptionPeriods.subscriptionId, subscriptionId))
    .orderBy(subscriptionPeriods.seq);
const outbox = (template: string) =>
  db.select().from(emailOutbox).where(eq(emailOutbox.template, template));
const cancelOpts = (actor: 'tenant' | 'admin', justification?: string) => ({
  actor,
  now: NOW,
  appBaseUrl: 'http://localhost:5173',
  fx: newAfterCommit(),
  ...(justification !== undefined && { justification }),
});

/** Pacote 20h active (6 h left) with its renewal period awaiting a pending Pix charge. */
async function hourWithRenewal(status = 'active') {
  const { user } = await createTenant(db, { now: NOW });
  const category = await seeded('Pacote 20h mensal');
  const { subscription, period } = await createSubscription(db, {
    userId: user.id,
    category,
    status,
    period: { status: 'active', minutesBalance: 360 },
  });
  const renewal = await withTransaction(db, (tx) => createRenewalPeriod(tx, subscription.id, NOW));
  const [charge] = await db
    .insert(charges)
    .values({
      provider: 'sandbox',
      purpose: 'subscription_renewal',
      method: 'pix',
      userId: user.id,
      subscriptionPeriodId: renewal?.id ?? null,
      amountCents: 160_000,
      status: 'pending',
      idempotencyKey: `ch_${randomUUID()}`,
    })
    .returning();
  return { user, subscription, period, renewal, charge, category };
}

/** Meio turno with period 1 active and period 2 held (22 held_for_renewal occurrences). */
async function fixedWithHeldNext() {
  const { user } = await createTenant(db, { now: NOW });
  const category = await seeded('Meio turno mensal');
  const room = await seededRoom(db);
  const { subscription, period } = await createSubscription(db, {
    userId: user.id,
    category,
    roomId: room.id,
    period: { status: 'paid' },
  });
  await withTransaction(db, (tx) =>
    activatePeriod(tx, job, period?.id ?? '', {
      now: NOW,
      appBaseUrl: 'http://localhost:5173',
      fx: newAfterCommit(),
    }),
  );
  return { user, subscription, period, room, category };
}

describe('cancelPreview (REC-79)', () => {
  it('hour package with 6 h left: minutesLost 360 and the extra minutes kept', async () => {
    const { user, subscription } = await hourWithRenewal();
    await createExtraLot(db, { userId: user.id, minutes: 300 });
    expect(await cancelPreview(db, subscription, NOW)).toEqual({
      minutesLost: 360,
      extraMinutesKept: 300,
    });
  });

  it('reports a paid upcoming period that will be lost', async () => {
    const { subscription, renewal } = await hourWithRenewal();
    await db
      .update(subscriptionPeriods)
      .set({ status: 'paid' })
      .where(eq(subscriptionPeriods.id, renewal?.id ?? ''));
    expect(await cancelPreview(db, subscription, NOW)).toMatchObject({
      minutesLost: 360,
      paidUpcomingPeriodLostCents: 160_000,
    });
  });

  it(
    'fixed schedule: counts the future and held occurrences to release',
    async () => {
      const { subscription } = await fixedWithHeldNext();
      expect(await cancelPreview(db, subscription, NOW)).toEqual({
        occurrencesReleased: 22,
        extraMinutesKept: 0,
      });
    },
    SLOW,
  );
});

describe('cancelSubscription (REC-80..REC-82)', () => {
  it('hour package: expiry entry, pending charge and future period cancelled, package bookings kept', async () => {
    const { user, subscription, period, renewal, charge } = await hourWithRenewal();
    const room = await seededRoom(db);
    const booking = await createBooking(db, {
      userId: user.id,
      roomId: room.id,
      startsAt: localToUtc('2026-11-04', 1140),
      endsAt: localToUtc('2026-11-04', 1200),
      paymentMode: 'package',
      totalCents: 0,
    });
    await withTransaction(db, (tx) =>
      cancelSubscription(tx, job, subscription.id, cancelOpts('tenant')),
    );
    expect(await subscriptionOf(subscription.id)).toMatchObject({ status: 'cancelled' });
    const [expiry] = await db
      .select()
      .from(packageLedger)
      .where(
        and(eq(packageLedger.periodId, period?.id ?? ''), eq(packageLedger.entryType, 'expiry')),
      );
    expect(expiry?.minutes).toBe(-360);
    expect((await periodsOf(subscription.id)).map((p) => [p.seq, p.status])).toEqual([
      [1, 'closed'],
      [2, 'cancelled'],
    ]);
    const [after] = await db
      .select()
      .from(charges)
      .where(eq(charges.id, charge?.id ?? ''));
    expect(after?.status).toBe('cancelled');
    const [kept] = await db.select().from(bookings).where(eq(bookings.id, booking.id));
    expect(kept?.status).toBe('confirmed');
    expect(renewal).not.toBeNull();
    expect(await outbox('subscription.cancelled')).toHaveLength(1);
  });

  it(
    'fixed schedule by the tenant: future occurrences cancelled_by_tenant, held ones expired, no refund',
    async () => {
      const { subscription, user, room } = await fixedWithHeldNext();
      const ahead = await createBooking(db, {
        userId: user.id,
        roomId: room.id,
        startsAt: localToUtc('2026-11-03', 420),
        endsAt: localToUtc('2026-11-03', 570),
        kind: 'fixed_occurrence',
        paymentMode: 'subscription',
      });
      await db
        .update(bookings)
        .set({ subscriptionId: subscription.id })
        .where(eq(bookings.id, ahead.id));
      await withTransaction(db, (tx) =>
        cancelSubscription(tx, job, subscription.id, cancelOpts('tenant')),
      );
      const after = await db
        .select()
        .from(bookings)
        .where(eq(bookings.subscriptionId, subscription.id));
      expect(after.find((b) => b.id === ahead.id)?.status).toBe('cancelled_by_tenant');
      const held = after.filter((b) => b.id !== ahead.id);
      expect(held).toHaveLength(22);
      expect(new Set(held.map((b) => b.status))).toEqual(new Set(['expired']));
      expect(
        await db
          .select()
          .from(roomOccupancy)
          .where(and(eq(roomOccupancy.roomId, room.id), eq(roomOccupancy.active, true))),
      ).toHaveLength(0);
      expect(await db.select().from(refunds)).toHaveLength(0);
    },
    SLOW,
  );

  it('fixed schedule by the admin: confirmed future occurrences cancelled_by_clinic and audited', async () => {
    const { user } = await createTenant(db, { now: NOW });
    const category = await seeded('Meio turno mensal');
    const room = await seededRoom(db);
    const { subscription } = await createSubscription(db, {
      userId: user.id,
      category,
      roomId: room.id,
    });
    const past = await createBooking(db, {
      userId: user.id,
      roomId: room.id,
      startsAt: localToUtc('2026-10-26', 420),
      endsAt: localToUtc('2026-10-26', 570),
      kind: 'fixed_occurrence',
      paymentMode: 'subscription',
    });
    const ahead = await createBooking(db, {
      userId: user.id,
      roomId: room.id,
      startsAt: localToUtc('2026-11-03', 420),
      endsAt: localToUtc('2026-11-03', 570),
      kind: 'fixed_occurrence',
      paymentMode: 'subscription',
    });
    await db
      .update(bookings)
      .set({ subscriptionId: subscription.id })
      .where(eq(bookings.userId, user.id));
    await withTransaction(db, (tx) =>
      cancelSubscription(
        tx,
        { ...job, origin: 'admin' },
        subscription.id,
        cancelOpts('admin', 'Cliente pediu pelo telefone'),
      ),
    );
    const rows = new Map(
      (await db.select().from(bookings).where(eq(bookings.userId, user.id))).map((b) => [
        b.id,
        b.status,
      ]),
    );
    expect(rows.get(ahead.id)).toBe('cancelled_by_clinic');
    expect(rows.get(past.id)).toBe('confirmed');
    const [entry] = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'subscription.cancel'));
    expect(entry).toMatchObject({
      entityId: subscription.id,
      justification: 'Cliente pediu pelo telefone',
    });
  });

  it('an ended subscription cannot be cancelled: 409 INVALID_TRANSITION', async () => {
    const { subscription } = await hourWithRenewal('ended');
    const error = await errorOf(
      withTransaction(db, (tx) =>
        cancelSubscription(tx, job, subscription.id, cancelOpts('tenant')),
      ),
    );
    expect([error.status, error.code]).toEqual([409, 'INVALID_TRANSITION']);
  });
});

describe('suspension and end of grace (REC-54, REC-57)', () => {
  it(
    'suspends at starts_on: period stays awaiting, held occurrences expire; a re-run changes nothing',
    async () => {
      const { subscription } = await fixedWithHeldNext();
      await withTransaction(db, (tx) => createRenewalPeriod(tx, subscription.id, NOW));
      expect(await suspendDue(deps(), job, new Date('2026-12-01T06:00:00Z'))).toBe(0);
      expect(await suspendDue(deps(), job, STARTS_ON)).toBe(1);
      expect(await suspendDue(deps(), job, STARTS_ON)).toBe(0);
      const after = await subscriptionOf(subscription.id);
      expect(after?.status).toBe('suspended');
      expect(after?.suspendedAt?.toISOString()).toBe(STARTS_ON.toISOString());
      const [, next] = await periodsOf(subscription.id);
      expect(next?.status).toBe('awaiting_payment');
      const held = await db
        .select()
        .from(bookings)
        .where(eq(bookings.subscriptionPeriodId, next?.id ?? ''));
      expect(new Set(held.map((b) => b.status))).toEqual(new Set(['expired']));
      expect(await outbox('subscription.suspended')).toHaveLength(1);
    },
    SLOW,
  );

  it('ends on starts_on + 7 (2026-12-09): ended, period failed, pending charge cancelled', async () => {
    const { subscription, renewal, charge } = await hourWithRenewal('suspended');
    expect(await endAfterGrace(deps(), job, new Date('2026-12-08T06:00:00Z'))).toBe(0);
    expect(await endAfterGrace(deps(), job, new Date('2026-12-09T06:00:00Z'))).toBe(1);
    expect(await subscriptionOf(subscription.id)).toMatchObject({ status: 'ended' });
    const [period] = await db
      .select()
      .from(subscriptionPeriods)
      .where(eq(subscriptionPeriods.id, renewal?.id ?? ''));
    expect(period?.status).toBe('failed');
    const [after] = await db
      .select()
      .from(charges)
      .where(eq(charges.id, charge?.id ?? ''));
    expect(after?.status).toBe('cancelled');
    expect(await outbox('subscription.ended')).toHaveLength(1);
  });
});

describe('payPending (REC-56, REC-151)', () => {
  it('regularizes a suspended hour package at full price: active again, full minutes, same dates', async () => {
    const { user, subscription, renewal } = await hourWithRenewal('suspended');
    const later = new Date('2026-12-04T12:00:00Z');
    const result = await payPending(
      deps(later),
      { ...job, actorUserId: user.id, origin: 'app' },
      { userId: user.id, subscriptionId: subscription.id, body: { paymentMethod: 'pix' } },
    );
    expect(result.charge).toMatchObject({
      purpose: 'subscription_renewal',
      amountCents: 160_000,
      status: 'pending',
    });
    await applyProviderStatus(deps(later), {
      provider: 'sandbox',
      chargeId: result.charge?.id ?? '',
      status: 'approved',
      amountCents: 160_000,
    });
    expect((await subscriptionOf(subscription.id))?.status).toBe('active');
    const [period] = await db
      .select()
      .from(subscriptionPeriods)
      .where(eq(subscriptionPeriods.id, renewal?.id ?? ''));
    expect(period).toMatchObject({
      status: 'active',
      minutesBalance: 1200,
      startsOn: '2026-12-02',
      endsOn: '2027-01-01',
    });
  });

  it(
    'regularizes a fixed schedule by re-holding only the free future occurrences and pricing them',
    async () => {
      const { user, subscription, room } = await fixedWithHeldNext();
      await withTransaction(db, (tx) => createRenewalPeriod(tx, subscription.id, NOW));
      await suspendDue(deps(), job, STARTS_ON);
      const { user: other } = await createTenant(db, { now: NOW });
      await createBooking(db, {
        userId: other.id,
        roomId: room.id,
        startsAt: localToUtc('2026-12-10', 480),
        endsAt: localToUtc('2026-12-10', 540),
      });
      const later = new Date('2026-12-04T12:00:00Z');
      const result = await payPending(
        deps(later),
        { ...job, actorUserId: user.id, origin: 'app' },
        { userId: user.id, subscriptionId: subscription.id, body: { paymentMethod: 'pix' } },
      );
      // 2026-12-07..2026-12-31 has 19 weekdays after 2026-12-04 09:00; 2026-12-10 is taken.
      expect(result.charge?.amountCents).toBe(18 * 28_000);
      const [, next] = await periodsOf(subscription.id);
      expect(next).toMatchObject({ occurrenceCount: 18, priceCents: 18 * 28_000 });
      const held = await db
        .select()
        .from(bookings)
        .where(
          and(
            eq(bookings.subscriptionPeriodId, next?.id ?? ''),
            eq(bookings.status, 'held_for_renewal'),
          ),
        );
      expect(held).toHaveLength(18);
    },
    SLOW,
  );

  it('pays the first period of a link sale and refuses after the hold expired', async () => {
    const { user } = await createTenant(db, { now: NOW });
    const category = await seeded('Pacote 20h mensal');
    const { subscription } = await createSubscription(db, {
      userId: user.id,
      category,
      status: 'awaiting_payment',
      holdExpiresAt: new Date('2026-10-27T12:00:00Z'),
      period: { status: 'awaiting_payment', minutesBalance: 0 },
    });
    const ctx = { ...job, actorUserId: user.id, origin: 'app' as const };
    const body = { paymentMethod: 'pix' as const };
    const paid = await payPending(deps(), ctx, {
      userId: user.id,
      subscriptionId: subscription.id,
      body,
    });
    expect(paid.charge).toMatchObject({ purpose: 'subscription_initial', amountCents: 160_000 });
    const late = await errorOf(
      payPending(deps(new Date('2026-10-27T12:00:00Z')), ctx, {
        userId: user.id,
        subscriptionId: subscription.id,
        body,
      }),
    );
    expect([late.status, late.code]).toEqual([409, 'HOLD_EXPIRED']);
  });

  it('credits covering a pending renewal settle it without a gateway charge', async () => {
    const { user, subscription, renewal, charge } = await hourWithRenewal();
    await createCreditLot(db, { userId: user.id, amountCents: 200_000 });
    const result = await payPending(
      deps(new Date('2026-11-30T12:00:00Z')),
      { ...job, actorUserId: user.id, origin: 'app' },
      {
        userId: user.id,
        subscriptionId: subscription.id,
        body: { paymentMethod: 'pix', useCredits: true },
      },
    );
    expect(result.charge).toBeNull();
    const [period] = await db
      .select()
      .from(subscriptionPeriods)
      .where(eq(subscriptionPeriods.id, renewal?.id ?? ''));
    expect(period?.status).toBe('paid');
    const [old] = await db
      .select()
      .from(charges)
      .where(eq(charges.id, charge?.id ?? ''));
    expect(old?.status).toBe('cancelled');
  });
});
