import { compensationPreviewSchema, localToUtc } from '@bravo/core';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTenant, seededRoom } from '../../../test/booking-helpers';
import { createBooking } from '../../../test/factories';
import {
  createFixedCategory,
  createHourPackageCategory,
  createSubscription,
} from '../../../test/factories/revenue';
import { requireTestDatabaseUrl } from '../../../test/require-test-db';
import { createDb, withTransaction } from '../../db/client';
import {
  bookings,
  closedDayCompensations,
  closedDays,
  creditLots,
  emailOutbox,
  extraMinuteLots,
  settings,
  subscriptionPeriods,
} from '../../db/schema';
import { runSeed } from '../../db/seed';
import type { RequestContext } from '../../lib/audit';
import {
  applyClosedDay,
  compensateKnownClosedDays,
  previewClosedDay,
} from './compensation.service';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

const NOW = new Date('2026-11-05T12:00:00.000Z');
const FRIDAY = '2026-11-20';
const ctx: RequestContext = {
  actorUserId: null,
  actorRole: 'admin',
  origin: 'admin',
  ip: null,
  requestId: null,
};
const opts = { now: NOW, appBaseUrl: 'http://localhost:5173' };

let principal = '';
let secundaria = '';
beforeEach(async () => {
  await runSeed(db);
  principal = (await seededRoom(db, 'principal')).id;
  secundaria = (await seededRoom(db, 'secundaria')).id;
});

/** A Pacote 20h subscriber and a Meio turno subscriber in Sala Principal with the Friday occurrence. */
async function subscribers() {
  const hour = await createTenant(db);
  const hourPkg = await createSubscription(db, {
    userId: hour.user.id,
    category: await createHourPackageCategory(db),
  });
  const fixed = await createTenant(db);
  const fixedSub = await createSubscription(db, {
    userId: fixed.user.id,
    category: await createFixedCategory(db),
    roomId: principal,
    period: { priceCents: 616_000, occurrenceCount: 22 },
  });
  const occurrence = await createBooking(db, {
    userId: fixed.user.id,
    roomId: principal,
    kind: 'fixed_occurrence',
    paymentMode: 'subscription',
    startsAt: localToUtc(FRIDAY, 420),
    endsAt: localToUtc(FRIDAY, 570),
    totalCents: 0,
    paidCents: 0,
    depositCents: 0,
  });
  return { hour, hourPkg, fixed, fixedSub, occurrence };
}

async function close(roomId: string | null = null) {
  const [day] = await db.insert(closedDays).values({ date: FRIDAY, roomId }).returning();
  if (day === undefined) throw new Error('no closed day');
  return day;
}

const apply = (ids: string[]) => withTransaction(db, (tx) => applyClosedDay(tx, ids, ctx, opts));

describe('previewClosedDay (REC-97)', () => {
  it('previews 2 subscribers, 40 min, R$ 205,33 and 1 fixed occurrence for a clinic-wide closure', async () => {
    await subscribers();
    const preview = compensationPreviewSchema.parse(
      await previewClosedDay(db, { date: FRIDAY, roomIds: null }),
    );
    expect(preview).toEqual({
      subscribers: 2,
      minutes: 40,
      creditCents: 20_533,
      fixedOccurrencesCancelled: 1,
    });
  });
});

describe('applyClosedDay (REC-98..REC-100, REC-104)', () => {
  it('grants a 40-min lot and a 20533-cent credit, cancels the Friday occurrence and queues two e-mails', async () => {
    const { hour, fixed, occurrence, hourPkg, fixedSub } = await subscribers();
    const day = await close();
    const result = await apply([day.id]);
    expect(result).toEqual({ compensations: 2, occurrencesCancelled: 1 });

    const [lot] = await db
      .select()
      .from(extraMinuteLots)
      .where(eq(extraMinuteLots.userId, hour.user.id));
    expect(lot).toMatchObject({
      source: 'closed_day_compensation',
      minutesGranted: 40,
      minutesRemaining: 40,
      expiresAt: new Date(NOW.getTime() + 90 * 86_400_000),
    });
    const [credit] = await db.select().from(creditLots).where(eq(creditLots.userId, fixed.user.id));
    expect(credit).toMatchObject({
      source: 'closed_day_compensation',
      amountCents: 20_533,
      remainingCents: 20_533,
    });

    const [cancelled] = await db.select().from(bookings).where(eq(bookings.id, occurrence.id));
    expect(cancelled?.status).toBe('cancelled_by_clinic');
    expect(cancelled?.paidCents).toBe(0);

    const rows = await db
      .select()
      .from(closedDayCompensations)
      .orderBy(closedDayCompensations.kind);
    expect(
      rows.map((r) => [
        r.kind,
        r.subscriptionId,
        r.creditLotId === null,
        r.extraMinuteLotId === null,
      ]),
    ).toEqual([
      ['credit', fixedSub.subscription.id, false, true],
      ['minutes', hourPkg.subscription.id, true, false],
    ]);
    const mails = await db
      .select()
      .from(emailOutbox)
      .where(eq(emailOutbox.template, 'subscription.compensation'));
    expect(mails.map((m) => m.toAddress).sort()).toEqual(
      [hour.user.email, fixed.user.email].sort(),
    );
  });

  it('cancels a held_for_renewal occurrence on the closed date', async () => {
    const { fixed } = await subscribers();
    const held = await createBooking(db, {
      userId: fixed.user.id,
      roomId: principal,
      kind: 'fixed_occurrence',
      paymentMode: 'subscription',
      status: 'held_for_renewal',
      startsAt: localToUtc(FRIDAY, 600),
      endsAt: localToUtc(FRIDAY, 660),
      totalCents: 0,
      paidCents: 0,
      depositCents: 0,
    });
    await apply([(await close()).id]);
    const [row] = await db.select().from(bookings).where(eq(bookings.id, held.id));
    expect(row?.status).toBe('cancelled_by_clinic');
  });

  it('a closure of the fixed room compensates the fixed schedule only, never the hour package (REC-101)', async () => {
    const { hour, fixed } = await subscribers();
    expect(await previewClosedDay(db, { date: FRIDAY, roomIds: [principal] })).toEqual({
      subscribers: 1,
      minutes: 0,
      creditCents: 20_533,
      fixedOccurrencesCancelled: 1,
    });
    await apply([(await close(principal)).id]);
    expect(
      await db.select().from(extraMinuteLots).where(eq(extraMinuteLots.userId, hour.user.id)),
    ).toHaveLength(0);
    expect(
      await db.select().from(creditLots).where(eq(creditLots.userId, fixed.user.id)),
    ).toHaveLength(1);
  });

  it('a closure of another room compensates nobody and cancels nothing', async () => {
    const { occurrence } = await subscribers();
    const result = await apply([(await close(secundaria)).id]);
    expect(result).toEqual({ compensations: 0, occurrencesCancelled: 0 });
    const [row] = await db.select().from(bookings).where(eq(bookings.id, occurrence.id));
    expect(row?.status).toBe('confirmed');
  });

  it('re-applying the same closed day creates nothing (REC-104)', async () => {
    await subscribers();
    const day = await close();
    await apply([day.id]);
    const again = await apply([day.id]);
    expect(again).toEqual({ compensations: 0, occurrencesCancelled: 0 });
    expect(await db.select().from(closedDayCompensations)).toHaveLength(2);
    expect(await db.select().from(extraMinuteLots)).toHaveLength(1);
    expect(await db.select().from(creditLots)).toHaveLength(1);
  });

  it('with payment.closed_day_compensation_enabled = false creates no compensation (REC-103)', async () => {
    await subscribers();
    await db
      .update(settings)
      .set({ value: false })
      .where(eq(settings.key, 'payment.closed_day_compensation_enabled'));
    expect(await previewClosedDay(db, { date: FRIDAY, roomIds: null })).toMatchObject({
      subscribers: 0,
      minutes: 0,
      creditCents: 0,
    });
    const result = await apply([(await close()).id]);
    expect(result.compensations).toBe(0);
    expect(await db.select().from(closedDayCompensations)).toHaveLength(0);
    expect(await db.select().from(creditLots)).toHaveLength(0);
  });

  it('ignores periods that do not cover the date or are not active/paid', async () => {
    const { hourPkg } = await subscribers();
    await db
      .update(subscriptionPeriods)
      .set({ status: 'closed' })
      .where(eq(subscriptionPeriods.id, hourPkg.period?.id ?? ''));
    const preview = await previewClosedDay(db, { date: '2026-12-10', roomIds: null });
    expect(preview).toMatchObject({ subscribers: 0, minutes: 0, creditCents: 0 });
    const friday = await previewClosedDay(db, { date: FRIDAY, roomIds: null });
    expect(friday).toMatchObject({ subscribers: 1, minutes: 0, creditCents: 20_533 });
  });
});

describe('compensateKnownClosedDays (REC-102)', () => {
  it('compensates a clinic-wide closed day already inside the activating hour-package period, once', async () => {
    const { user } = await createTenant(db);
    const { period } = await createSubscription(db, {
      userId: user.id,
      category: await createHourPackageCategory(db),
    });
    await close();
    await db.insert(closedDays).values({ date: '2026-11-21', roomId: principal });
    const first = await withTransaction(db, (tx) =>
      compensateKnownClosedDays(tx, period?.id ?? '', ctx, opts),
    );
    const second = await withTransaction(db, (tx) =>
      compensateKnownClosedDays(tx, period?.id ?? '', ctx, opts),
    );
    expect([first, second]).toEqual([1, 0]);
    const lots = await db
      .select()
      .from(extraMinuteLots)
      .where(
        and(
          eq(extraMinuteLots.userId, user.id),
          eq(extraMinuteLots.source, 'closed_day_compensation'),
        ),
      );
    expect(lots.map((l) => l.minutesGranted)).toEqual([40]);
  });
});
