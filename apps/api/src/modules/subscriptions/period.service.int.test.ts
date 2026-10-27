import { localToUtc } from '@bravo/core';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTenant, seededRoom } from '../../../test/booking-helpers';
import { createSubscription } from '../../../test/factories/revenue';
import { requireTestDatabaseUrl } from '../../../test/require-test-db';
import { createDb, withTransaction } from '../../db/client';
import {
  blocks,
  bookingCategories,
  bookings,
  closedDays,
  emailOutbox,
  extraMinuteLots,
  packageLedger,
  roomOccupancy,
  subscriptionPeriods,
} from '../../db/schema';
import { runSeed } from '../../db/seed';
import type { RequestContext } from '../../lib/audit';
import { AppError } from '../../lib/errors';
import { newAfterCommit } from '../booking/effects';
import { insertOccurrences } from './occurrences.service';
import { activatePeriod, closePeriod, createRenewalPeriod } from './period.service';
import { transitionPeriod, transitionSubscription } from './transitions';
import { loadSettings } from '../settings/settings.repo';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

// Monday 2026-10-26 09:00 BRT.
const NOW = new Date('2026-10-26T12:00:00.000Z');
const ctx: RequestContext = {
  actorUserId: null,
  actorRole: null,
  origin: 'job',
  ip: null,
  requestId: null,
};
const opts = () => ({ now: NOW, appBaseUrl: 'http://localhost:5173', fx: newAfterCommit() });

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

const periodsOf = (subscriptionId: string) =>
  db
    .select()
    .from(subscriptionPeriods)
    .where(eq(subscriptionPeriods.subscriptionId, subscriptionId))
    .orderBy(subscriptionPeriods.seq);

async function hourPackage(status = 'paid', minutesBalance = 0) {
  const { user } = await createTenant(db, { now: NOW });
  const category = await seeded('Pacote 20h mensal');
  const created = await createSubscription(db, {
    userId: user.id,
    category,
    period: { status, minutesBalance },
  });
  return { user, category, ...created };
}

/** A Meio turno subscription whose first period (2026-11-02) is paid with its 22 occurrences. */
async function fixedSchedule() {
  const { user } = await createTenant(db, { now: NOW });
  const category = await seeded('Meio turno mensal');
  const room = await seededRoom(db);
  const created = await createSubscription(db, {
    userId: user.id,
    category,
    roomId: room.id,
    period: { status: 'paid' },
  });
  return { user, category, room, ...created };
}

describe('activatePeriod (REC-16, REC-102)', () => {
  it('grants the 1200 included minutes once; a second activation is INVALID_TRANSITION', async () => {
    const { period } = await hourPackage();
    const active = await withTransaction(db, (tx) =>
      activatePeriod(tx, ctx, period?.id ?? '', opts()),
    );
    expect(active).toMatchObject({ status: 'active', minutesBalance: 1200 });
    expect(active.paidAt?.toISOString()).toBe(NOW.toISOString());
    const again = await errorOf(
      withTransaction(db, (tx) => activatePeriod(tx, ctx, period?.id ?? '', opts())),
    );
    expect(again.code).toBe('INVALID_TRANSITION');
    const grants = await db
      .select()
      .from(packageLedger)
      .where(
        and(
          eq(packageLedger.periodId, period?.id ?? ''),
          eq(packageLedger.entryType, 'period_grant'),
        ),
      );
    expect(grants.map((g) => g.minutes)).toEqual([1200]);
  });

  it('compensates a clinic closure already inside the period with a 40-min lot', async () => {
    const { user, period } = await hourPackage();
    await db.insert(closedDays).values({ date: '2026-11-20', roomId: null });
    await withTransaction(db, (tx) => activatePeriod(tx, ctx, period?.id ?? '', opts()));
    const lots = await db.select().from(extraMinuteLots).where(eq(extraMinuteLots.userId, user.id));
    expect(lots.map((l) => [l.source, l.minutesGranted])).toEqual([
      ['closed_day_compensation', 40],
    ]);
  });
});

describe('holding the next fixed period (REC-92, REC-93)', () => {
  it('creates seq 2 upcoming and holds its 22 free occurrences as held_for_renewal', async () => {
    const { subscription, period } = await fixedSchedule();
    await withTransaction(db, (tx) => activatePeriod(tx, ctx, period?.id ?? '', opts()));
    const periods = await periodsOf(subscription.id);
    expect(periods.map((p) => [p.seq, p.status])).toEqual([
      [1, 'active'],
      [2, 'upcoming'],
    ]);
    expect(periods[1]).toMatchObject({
      startsOn: '2026-12-02',
      endsOn: '2027-01-01',
      occurrenceCount: 22,
      priceCents: 616_000,
      heldConflicts: [],
    });
    const held = await db
      .select()
      .from(bookings)
      .where(eq(bookings.subscriptionPeriodId, periods[1]?.id ?? ''));
    expect(held).toHaveLength(22);
    expect(new Set(held.map((b) => b.status))).toEqual(new Set(['held_for_renewal']));
    expect(new Set(held.map((b) => b.kind))).toEqual(new Set(['fixed_occurrence']));
  });

  it('stores a blocked date in held_conflicts and queues one next_period_conflicts e-mail', async () => {
    const { subscription, period, room } = await fixedSchedule();
    const [block] = await db
      .insert(blocks)
      .values({
        roomId: room.id,
        tag: 'Manutenção',
        startsAt: localToUtc('2026-12-09', 420),
        endsAt: localToUtc('2026-12-09', 480),
      })
      .returning();
    await db.insert(roomOccupancy).values({
      roomId: room.id,
      period: `[${localToUtc('2026-12-09', 420).toISOString()},${localToUtc('2026-12-09', 480).toISOString()})`,
      kind: 'block',
      refId: block?.id ?? '',
    });
    await withTransaction(db, (tx) => activatePeriod(tx, ctx, period?.id ?? '', opts()));
    const [, next] = await periodsOf(subscription.id);
    expect(next).toMatchObject({
      occurrenceCount: 21,
      priceCents: 21 * 28_000,
      heldConflicts: [{ date: '2026-12-09', reason: 'overlaps_block' }],
    });
    const mails = await db
      .select()
      .from(emailOutbox)
      .where(eq(emailOutbox.template, 'subscription.next_period_conflicts'));
    expect(mails).toHaveLength(1);
    expect(mails[0]?.textBody).toContain('09/12/2026: Bloqueado');
  });
});

describe('closePeriod (REC-53)', () => {
  it('closes the active period with an expiry entry for the minutes left', async () => {
    const { period } = await hourPackage('active', 360);
    const { period: closed, expiredMinutes } = await withTransaction(db, (tx) =>
      closePeriod(tx, ctx, period?.id ?? '', NOW),
    );
    expect(expiredMinutes).toBe(360);
    expect(closed).toMatchObject({ status: 'closed', minutesBalance: 0 });
    const [expiry] = await db
      .select()
      .from(packageLedger)
      .where(
        and(eq(packageLedger.periodId, period?.id ?? ''), eq(packageLedger.entryType, 'expiry')),
      );
    expect(expiry?.minutes).toBe(-360);
  });
});

describe('createRenewalPeriod (REC-47, REC-93, REC-125)', () => {
  it('hour package: seq 2 awaiting_payment at the current category price, no coupon, once', async () => {
    const { subscription, category } = await hourPackage('active');
    await db
      .update(bookingCategories)
      .set({ fixedPriceCents: 170_000, version: 2 })
      .where(eq(bookingCategories.id, category.id));
    const first = await withTransaction(db, (tx) => createRenewalPeriod(tx, subscription.id, NOW));
    expect(first).toMatchObject({
      seq: 2,
      status: 'awaiting_payment',
      startsOn: '2026-12-02',
      endsOn: '2027-01-01',
      priceCents: 170_000,
      discountCents: 0,
      includedMinutes: 1200,
      minutesBalance: 0,
      priceSnapshot: { categoryVersion: 2, priceCents: 170_000, includedMinutes: 1200 },
    });
    expect(first?.chargeDueAt.toISOString()).toBe('2026-11-30T03:00:00.000Z');
    const second = await withTransaction(db, (tx) => createRenewalPeriod(tx, subscription.id, NOW));
    expect(second?.id).toBe(first?.id);
    expect(await periodsOf(subscription.id)).toHaveLength(2);
  });

  it('fixed: promotes the upcoming period priced per occurrence × held count', async () => {
    const { subscription, period, category } = await fixedSchedule();
    await withTransaction(db, (tx) => activatePeriod(tx, ctx, period?.id ?? '', opts()));
    await db
      .update(bookingCategories)
      .set({ pricePerOccurrenceCents: 30_000 })
      .where(eq(bookingCategories.id, category.id));
    const renewal = await withTransaction(db, (tx) =>
      createRenewalPeriod(tx, subscription.id, NOW),
    );
    expect(renewal).toMatchObject({
      seq: 2,
      status: 'awaiting_payment',
      occurrenceCount: 22,
      priceCents: 22 * 30_000,
    });
  });

  it('fixed: a closed day known at pricing reduces the count (no compensation)', async () => {
    const { subscription, period, user } = await fixedSchedule();
    await withTransaction(db, (tx) => activatePeriod(tx, ctx, period?.id ?? '', opts()));
    const [, next] = await periodsOf(subscription.id);
    const [held] = await db
      .select()
      .from(bookings)
      .where(eq(bookings.subscriptionPeriodId, next?.id ?? ''))
      .orderBy(bookings.startsAt)
      .limit(1);
    await db
      .update(bookings)
      .set({ status: 'cancelled_by_clinic' })
      .where(eq(bookings.id, held?.id ?? ''));
    const renewal = await withTransaction(db, (tx) =>
      createRenewalPeriod(tx, subscription.id, NOW),
    );
    expect(renewal).toMatchObject({ occurrenceCount: 21, priceCents: 21 * 28_000 });
    const lots = await db.select().from(extraMinuteLots).where(eq(extraMinuteLots.userId, user.id));
    expect(lots).toHaveLength(0);
  });
});

describe('state machines (REC-60, REC-61)', () => {
  it('rejects illegal subscription and period transitions with 409 INVALID_TRANSITION', async () => {
    const { subscription, period } = await hourPackage('active');
    await db
      .update(subscriptionPeriods)
      .set({ status: 'closed' })
      .where(eq(subscriptionPeriods.id, period?.id ?? ''));
    const sub = await errorOf(
      withTransaction(db, (tx) =>
        transitionSubscription(tx, subscription.id, ['active'], 'expired', NOW),
      ),
    );
    expect([sub.status, sub.code]).toEqual([409, 'INVALID_TRANSITION']);
    const per = await errorOf(
      withTransaction(db, (tx) =>
        transitionPeriod(tx, period?.id ?? '', ['closed'], 'active', NOW),
      ),
    );
    expect([per.status, per.code]).toEqual([409, 'INVALID_TRANSITION']);
  });

  it('activating an upcoming period is INVALID_TRANSITION and grants nothing', async () => {
    const { period } = await hourPackage('upcoming');
    const error = await errorOf(
      withTransaction(db, (tx) => activatePeriod(tx, ctx, period?.id ?? '', opts())),
    );
    expect(error.code).toBe('INVALID_TRANSITION');
    expect(
      await db
        .select()
        .from(packageLedger)
        .where(eq(packageLedger.periodId, period?.id ?? '')),
    ).toHaveLength(0);
  });

  it('a held occurrence inserted twice for one date is refused (no double hold)', async () => {
    const { subscription, period, room, user } = await fixedSchedule();
    const settings = await loadSettings(db);
    const occurrence = {
      date: '2026-11-03' as const,
      startsAt: localToUtc('2026-11-03', 420),
      endsAt: localToUtc('2026-11-03', 570),
    };
    const args = {
      userId: user.id,
      roomId: room.id,
      subscriptionId: subscription.id,
      periodId: period?.id ?? '',
      status: 'held_for_renewal' as const,
      holdExpiresAt: null,
      source: 'web' as const,
      settings,
      occurrences: [occurrence],
    };
    await withTransaction(db, (tx) => insertOccurrences(tx, ctx, args));
    const error = await errorOf(withTransaction(db, (tx) => insertOccurrences(tx, ctx, args)));
    expect(error.code).toBe('OCCURRENCE_CONFLICT');
  });
});
