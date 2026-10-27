import { generateOccurrences, localToUtc } from '@bravo/core';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTenant, seededRoom } from '../../../test/booking-helpers';
import { createHourPackageCategory, createSubscription } from '../../../test/factories/revenue';
import { forbiddenFetch, testEnv } from '../../../test/http';
import { requireTestDatabaseUrl } from '../../../test/require-test-db';
import { createDb, withTransaction } from '../../db/client';
import {
  bookingCategories,
  bookings,
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
import { addPeriodEntry } from '../packages/minutes.service';
import { applyProviderStatus } from '../payments/payment-effects.service';
import { loadSettings } from '../settings/settings.repo';
import { insertOccurrences } from './occurrences.service';
import { quoteSwitch, startSwitch } from './switch.service';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

// Monday 2026-10-26 09:00 BRT; approvals on Tuesday 2026-10-27 unless said otherwise.
const NOW = new Date('2026-10-26T12:00:00.000Z');
const NEXT_DAY = new Date('2026-10-27T12:00:00.000Z');
const deps = (now = NOW) => ({
  db,
  env: testEnv(),
  fetch: forbiddenFetch,
  now: () => now,
  registry: buildRegistry(),
});
const ctxOf = (userId: string): RequestContext => ({
  actorUserId: userId,
  actorRole: 'tenant',
  origin: 'app',
  ip: null,
  requestId: null,
});

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
const ledgerOf = (subscriptionId: string) =>
  db
    .select({ type: packageLedger.entryType, minutes: packageLedger.minutes })
    .from(packageLedger)
    .where(eq(packageLedger.subscriptionId, subscriptionId))
    .orderBy(packageLedger.id);

/** 360 min left on Pacote 20h (160000/1200) and a 225000/1800 target. */
async function hourSetup() {
  const { user } = await createTenant(db, { now: NOW });
  const current = await seeded('Pacote 20h mensal');
  const target = await createHourPackageCategory(db, {
    name: 'Pacote 30h especial',
    fixedPriceCents: 225_000,
    includedMinutes: 1800,
  });
  const { subscription, period } = await createSubscription(db, {
    userId: user.id,
    category: current,
    baseOn: '2026-10-12',
    period: { status: 'active', minutesBalance: 360 },
  });
  return { user, target, subscription, period };
}

const switchTo = (userId: string, subscriptionId: string, categoryId: string, roomId?: string) =>
  startSwitch(deps(), ctxOf(userId), {
    userId,
    subscriptionId,
    body: { categoryId, paymentMethod: 'pix', ...(roomId !== undefined && { roomId }) },
  });

const approve = (chargeId: string, amountCents: number, now = NEXT_DAY) =>
  applyProviderStatus(deps(now), {
    provider: 'sandbox',
    chargeId,
    status: 'approved',
    amountCents,
  });

describe('hour package switch (REC-71..REC-76)', () => {
  it('quotes 360 → 384 converted plus 1800 included, period from today at full price', async () => {
    const { user, target, subscription } = await hourSetup();
    const quote = await quoteSwitch(db, {
      userId: user.id,
      subscriptionId: subscription.id,
      input: { categoryId: target.id },
      now: NOW,
    });
    expect(quote).toEqual({
      remainingMinutes: 360,
      convertedMinutes: 384,
      newIncludedMinutes: 1800,
      newPeriodTotalMinutes: 2184,
      startsOn: '2026-10-26',
      endsOn: '2026-11-25',
      priceCents: 225_000,
      creditAppliedCents: 0,
      payNowCents: 225_000,
    });
  });

  it('starts a switch: new subscription awaiting payment pointing to the old one, old untouched', async () => {
    const { user, target, subscription } = await hourSetup();
    const result = await switchTo(user.id, subscription.id, target.id);
    expect(await subscriptionOf(result.subscriptionId)).toMatchObject({
      status: 'awaiting_payment',
      switchFromSubscriptionId: subscription.id,
      categoryId: target.id,
    });
    expect(result.charge).toMatchObject({
      purpose: 'subscription_initial',
      status: 'pending',
      amountCents: 225_000,
    });
    expect((await subscriptionOf(subscription.id))?.status).toBe('active');
  });

  it('approval converts at approval: conversion_out −360, conversion_in +384, old switched, new base date', async () => {
    const { user, target, subscription } = await hourSetup();
    const result = await switchTo(user.id, subscription.id, target.id);
    await approve(result.charge?.id ?? '', 225_000);

    expect(await subscriptionOf(subscription.id)).toMatchObject({
      status: 'switched',
      switchedToSubscriptionId: result.subscriptionId,
    });
    expect((await periodsOf(subscription.id))[0]).toMatchObject({
      status: 'closed',
      minutesBalance: 0,
    });
    expect(await ledgerOf(subscription.id)).toEqual([
      { type: 'period_grant', minutes: 360 },
      { type: 'conversion_out', minutes: -360 },
    ]);
    expect(await subscriptionOf(result.subscriptionId)).toMatchObject({
      status: 'active',
      baseOn: '2026-10-27',
    });
    const [period] = await periodsOf(result.subscriptionId);
    expect(period).toMatchObject({
      status: 'active',
      startsOn: '2026-10-27',
      endsOn: '2026-11-26',
      minutesBalance: 2184,
    });
    expect(await ledgerOf(result.subscriptionId)).toEqual([
      { type: 'period_grant', minutes: 1800 },
      { type: 'conversion_in', minutes: 384 },
    ]);
  });

  it('a booking debited between quote and approval reduces the converted amount (REC-74)', async () => {
    const { user, target, subscription, period } = await hourSetup();
    const result = await switchTo(user.id, subscription.id, target.id);
    await withTransaction(db, (tx) =>
      addPeriodEntry(tx, ctxOf(user.id), {
        periodId: period?.id ?? '',
        entryType: 'debit',
        minutes: -60,
        now: NOW,
      }),
    );
    await approve(result.charge?.id ?? '', 225_000);
    expect(await ledgerOf(result.subscriptionId)).toEqual([
      { type: 'period_grant', minutes: 1800 },
      { type: 'conversion_in', minutes: 320 },
    ]);
  });

  it('a rejected switch charge leaves the old subscription unchanged (REC-75)', async () => {
    const { user, target, subscription } = await hourSetup();
    const result = await switchTo(user.id, subscription.id, target.id);
    await applyProviderStatus(deps(), {
      provider: 'sandbox',
      chargeId: result.charge?.id ?? '',
      status: 'rejected',
    });
    expect((await subscriptionOf(subscription.id))?.status).toBe('active');
    expect((await periodsOf(subscription.id))[0]?.minutesBalance).toBe(360);
    expect((await subscriptionOf(result.subscriptionId))?.status).toBe('awaiting_payment');
  });

  it('an approval after the switch hold expired is refunded and the old subscription kept', async () => {
    const { user, target, subscription } = await hourSetup();
    const result = await switchTo(user.id, subscription.id, target.id);
    await db
      .update(subscriptions)
      .set({ status: 'expired' })
      .where(eq(subscriptions.id, result.subscriptionId));
    await approve(result.charge?.id ?? '', 225_000);
    expect((await subscriptionOf(subscription.id))?.status).toBe('active');
    const [refund] = await db
      .select()
      .from(refunds)
      .where(eq(refunds.chargeId, result.charge?.id ?? ''));
    expect(refund).toMatchObject({ amountCents: 225_000, reason: 'late_approval_conflict' });
  });

  it('rejects a target of another type or the same category with 422 on categoryId (REC-76)', async () => {
    const { user, subscription } = await hourSetup();
    const fixed = await seeded('Meio turno mensal');
    for (const categoryId of [fixed.id, subscription.categoryId]) {
      const error = await errorOf(
        quoteSwitch(db, {
          userId: user.id,
          subscriptionId: subscription.id,
          input: { categoryId },
          now: NOW,
        }),
      );
      expect(error.status).toBe(422);
      expect(error.details).toEqual([expect.objectContaining({ path: 'categoryId' })]);
      const started = await errorOf(switchTo(user.id, subscription.id, categoryId));
      expect(started.details).toEqual([expect.objectContaining({ path: 'categoryId' })]);
    }
  });
});

// Each fixed switch writes ~60 occurrences on a remote branch: allow more than the default 60 s.
const FIXED_TIMEOUT = 240_000;

describe('fixed schedule switch (REC-77, REC-78)', () => {
  /** Meio turno active since today in Sala Principal with its 21 future occurrences confirmed. */
  async function fixedSetup() {
    const { user } = await createTenant(db, { now: NOW });
    const meio = await seeded('Meio turno mensal');
    const turno = await seeded('Turno mensal');
    const room = await seededRoom(db);
    const { subscription, period } = await createSubscription(db, {
      userId: user.id,
      category: meio,
      roomId: room.id,
      baseOn: '2026-10-26',
      period: { status: 'active', occurrenceCount: 21, priceCents: 21 * 28_000 },
    });
    const settings = await loadSettings(db);
    await withTransaction(db, (tx) =>
      insertOccurrences(tx, ctxOf(user.id), {
        userId: user.id,
        roomId: room.id,
        subscriptionId: subscription.id,
        periodId: period?.id ?? '',
        status: 'confirmed',
        holdExpiresAt: null,
        source: 'web',
        settings,
        occurrences: generateOccurrences({
          baseOn: '2026-10-26',
          periodDays: 30,
          weekdays: [1, 2, 3, 4, 5],
          startMinute: 420,
          endMinute: 570,
          notBefore: NOW,
        }),
      }),
    );
    return { user, turno, room, subscription };
  }

  const statusesOf = async (subscriptionId: string) =>
    (await db.select().from(bookings).where(eq(bookings.subscriptionId, subscriptionId))).map(
      (b) => b.status,
    );

  it(
    'quotes the release of the 21 own occurrences without reporting them as conflicts',
    async () => {
      const { user, turno, subscription } = await fixedSetup();
      const quote = await quoteSwitch(db, {
        userId: user.id,
        subscriptionId: subscription.id,
        input: { categoryId: turno.id },
        now: NOW,
      });
      expect(quote).toMatchObject({
        releasedOccurrences: 21,
        conflicts: [],
        priceCents: 21 * 50_000,
        startsOn: '2026-10-26',
      });
    },
    FIXED_TIMEOUT,
  );

  it(
    'approval releases the old future occurrences and reserves Turno mensal in the same room',
    async () => {
      const { user, turno, subscription, room } = await fixedSetup();
      const result = await switchTo(user.id, subscription.id, turno.id);
      await approve(result.charge?.id ?? '', 21 * 50_000, NOW);
      expect(new Set(await statusesOf(subscription.id))).toEqual(new Set(['cancelled_by_tenant']));
      const fresh = await db
        .select()
        .from(bookings)
        .where(eq(bookings.subscriptionId, result.subscriptionId));
      expect(fresh.filter((b) => b.status === 'confirmed')).toHaveLength(21);
      expect(new Set(fresh.map((b) => b.roomId))).toEqual(new Set([room.id]));
      expect((await subscriptionOf(subscription.id))?.status).toBe('switched');
      const [period] = await periodsOf(result.subscriptionId);
      expect(period).toMatchObject({
        status: 'active',
        occurrenceCount: 21,
        priceCents: 21 * 50_000,
      });
    },
    FIXED_TIMEOUT,
  );

  it(
    'a slot taken at approval refunds the charge and keeps the old subscription (REC-78)',
    async () => {
      const { user, turno, subscription, room } = await fixedSetup();
      // Occupancy the availability read cannot see: only the insert at approval meets it.
      await db.insert(roomOccupancy).values({
        roomId: room.id,
        period: `[${localToUtc('2026-10-28', 600).toISOString()},${localToUtc('2026-10-28', 630).toISOString()})`,
        kind: 'block',
        refId: subscription.id,
      });
      const result = await switchTo(user.id, subscription.id, turno.id);
      await approve(result.charge?.id ?? '', 21 * 50_000, NOW);
      expect((await subscriptionOf(subscription.id))?.status).toBe('active');
      expect(new Set(await statusesOf(subscription.id))).toEqual(new Set(['confirmed']));
      expect((await subscriptionOf(result.subscriptionId))?.status).toBe('expired');
      const [refund] = await db
        .select()
        .from(refunds)
        .where(
          and(
            eq(refunds.chargeId, result.charge?.id ?? ''),
            eq(refunds.reason, 'late_approval_conflict'),
          ),
        );
      expect(refund?.amountCents).toBe(21 * 50_000);
    },
    FIXED_TIMEOUT,
  );
});
