import { randomUUID } from 'node:crypto';
import { localToUtc, type LocalDate } from '@bravo/core';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCharge, createStaff, createTenant, seededRoom } from '../../test/booking-helpers';
import { createBooking as insertBooking } from '../../test/factories';
import { forbiddenFetch, send, testEnv } from '../../test/http';
import { requireTestDatabaseUrl } from '../../test/require-test-db';
import { createApp } from '../app';
import { createDb } from '../db/client';
import {
  blockRecurrences,
  blocks,
  bookingEvents,
  bookingRescheduleRequests,
  bookings,
  charges,
  emailOutbox,
  idempotencyKeys,
  jobRuns,
} from '../db/schema';
import { runSeed } from '../db/seed';
import { createRegistry, type CheckoutStep, type Registry } from '../extensions/registry';
import { expireHolds } from './expire-holds';
import { materializeBlocks } from './materialize-blocks';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

const NOW = new Date('2026-10-20T12:00:00.000Z');
const MINUTE = 60_000;
const TUE = '2026-10-27' as LocalDate;
const after = (minutes: number) => new Date(NOW.getTime() + minutes * MINUTE);

let roomId = '';

beforeEach(async () => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  await runSeed(db);
  roomId = (await seededRoom(db)).id;
});

const depsAt = (now: Date, override: Partial<Registry> = {}) => ({
  db,
  env: testEnv(),
  fetch: forbiddenFetch,
  now: () => now,
  registry: createRegistry(override),
});

/** A holding booking on Tuesday whose hold ended `expiredMinutesAgo` minutes before NOW. */
async function holding(
  userId: string,
  overrides: Partial<Parameters<typeof insertBooking>[1]> = {},
  slot: { start: number; end: number } = { start: 840, end: 900 },
) {
  return insertBooking(db, {
    userId,
    roomId,
    startsAt: localToUtc(TUE, slot.start),
    endsAt: localToUtc(TUE, slot.end),
    status: 'awaiting_payment',
    paidCents: 0,
    holdExpiresAt: after(-1),
    ...overrides,
  });
}

const activeOccupancy = async (bookingId: string) => {
  const { rows } = await pool.query(`select 1 from room_occupancy where ref_id = $1 and active`, [
    bookingId,
  ]);
  return rows.length;
};

describe('expire-holds: bookings (NUC-197, NUC-166)', () => {
  it('expires an awaiting booking: slot freed, pending charge cancelled, steps released', async () => {
    const { user } = await createTenant(db, { now: NOW });
    const row = await holding(user.id);
    const pending = await createCharge(db, {
      userId: user.id,
      bookingId: row.id,
      purpose: 'booking_deposit',
      amountCents: 4850,
      status: 'pending',
      externalId: null,
    });
    const released: string[] = [];
    const step: CheckoutStep = {
      name: 'probe',
      order: 500,
      apply: (_ctx, draft) => Promise.resolve(draft),
      release: (_tx, booking, reason) => {
        released.push(`${booking.id}:${reason}`);
        return Promise.resolve();
      },
    };

    const stats = await expireHolds(depsAt(NOW, { checkoutSteps: [step] }), NOW);

    expect(stats).toMatchObject({ expiredBookings: 1, expiredPreReservations: 0 });
    const [stored] = await db.select().from(bookings).where(eq(bookings.id, row.id));
    expect(stored?.status).toBe('expired');
    expect(await activeOccupancy(row.id)).toBe(0);
    expect((await db.select().from(charges).where(eq(charges.id, pending.id)))[0]?.status).toBe(
      'cancelled',
    );
    expect(released).toEqual([`${row.id}:expired`]);
    const events = await db.select().from(bookingEvents);
    expect(events[0]).toMatchObject({
      fromStatus: 'awaiting_payment',
      toStatus: 'expired',
      origin: 'job',
    });
  });

  it('leaves a live hold and a held fixed occurrence past its hold untouched', async () => {
    const { user } = await createTenant(db, { now: NOW });
    const live = await holding(user.id, { holdExpiresAt: after(10) });
    const fixed = await holding(
      user.id,
      { kind: 'fixed_occurrence', status: 'held_for_renewal' },
      { start: 1000, end: 1060 },
    );
    const fixedAwaiting = await holding(
      user.id,
      { kind: 'fixed_occurrence' },
      { start: 1100, end: 1160 },
    );

    const stats = await expireHolds(depsAt(NOW), NOW);

    expect(stats).toMatchObject({ expiredBookings: 0 });
    const rows = await db.select().from(bookings);
    const statusOf = (id: string) => rows.find((r) => r.id === id)?.status;
    expect([statusOf(live.id), statusOf(fixed.id), statusOf(fixedAwaiting.id)]).toEqual([
      'awaiting_payment',
      'held_for_renewal',
      'awaiting_payment',
    ]);
    expect(await activeOccupancy(fixed.id)).toBe(1);
  });

  it('expires a pre-reservation: customer e-mail and staff event', async () => {
    const { user } = await createTenant(db, { now: NOW });
    const row = await holding(user.id, { status: 'pre_reserved' });
    const notifyStaff = vi.fn(() => Promise.resolve());

    const stats = await expireHolds(depsAt(NOW, { notifications: { notifyStaff } }), NOW);

    expect(stats).toMatchObject({ expiredBookings: 1, expiredPreReservations: 1 });
    expect((await db.select().from(bookings).where(eq(bookings.id, row.id)))[0]?.status).toBe(
      'expired',
    );
    const [mail] = await db.select().from(emailOutbox);
    expect(mail).toMatchObject({
      template: 'booking.pre_reservation_expired',
      toAddress: user.email,
    });
    expect(notifyStaff).toHaveBeenCalledWith('pre_reservation_expired', {
      entityId: row.id,
      code: row.code,
    });
  });

  it('is safe to run twice: the second run finds nothing', async () => {
    const { user } = await createTenant(db, { now: NOW });
    await holding(user.id);

    const first = await expireHolds(depsAt(NOW), NOW);
    const second = await expireHolds(depsAt(NOW), NOW);

    expect(first).toMatchObject({ expiredBookings: 1 });
    expect(second).toMatchObject({ expiredBookings: 0 });
    expect(await db.select().from(bookingEvents)).toHaveLength(1);
  });
});

describe('expire-holds: reschedule requests and keys (NUC-147, NUC-200)', () => {
  it('expires an unpaid reschedule request: hold block and charge cancelled, booking unchanged', async () => {
    const { user, cookie } = await createTenant(db, { now: NOW });
    const row = await insertBooking(db, {
      userId: user.id,
      roomId,
      startsAt: localToUtc(TUE, 840),
      endsAt: localToUtc(TUE, 900),
      totalCents: 9700,
      depositCents: 4851,
      paidCents: 4851,
    });
    const app = createApp({ db, now: () => NOW, fetch: forbiddenFetch, env: testEnv() });
    const started = await send(app, 'POST', `/app/bookings/${row.id}/reschedule`, {
      cookie,
      body: { date: '2026-10-28', startMinute: 840, endMinute: 1020, method: 'pix' },
      headers: { 'Idempotency-Key': randomUUID() },
    });
    expect(started.status).toBe(202);

    const stats = await expireHolds(depsAt(after(16)), after(16));

    expect(stats).toMatchObject({ expiredRescheduleRequests: 1 });
    const [request] = await db.select().from(bookingRescheduleRequests);
    expect(request?.status).toBe('expired');
    expect((await db.select().from(blocks))[0]?.cancelledAt).not.toBeNull();
    const [charge] = await db.select().from(charges);
    expect(charge?.status).toBe('cancelled');
    const [stored] = await db.select().from(bookings).where(eq(bookings.id, row.id));
    expect(stored).toMatchObject({ status: 'confirmed', rescheduleCount: 0, totalCents: 9700 });
    expect(await activeOccupancy(row.id)).toBe(1);
  });

  it('deletes the expired idempotency keys and keeps the live ones', async () => {
    const { user } = await createTenant(db, { now: NOW });
    const base = { userId: user.id, route: 'POST /app/bookings', requestHash: 'h' };
    await db.insert(idempotencyKeys).values([
      { ...base, key: 'expired-key-0001', expiresAt: after(-1) },
      { ...base, key: 'live-key-00000001', expiresAt: after(60) },
    ]);

    const stats = await expireHolds(depsAt(NOW), NOW);

    expect(stats).toMatchObject({ purgedIdempotencyKeys: 1 });
    expect((await db.select().from(idempotencyKeys)).map((k) => k.key)).toEqual([
      'live-key-00000001',
    ]);
  });
});

describe('materialize-blocks (NUC-57, NUC-200)', () => {
  it('extends recurring blocks once and deletes job runs older than 30 days', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    await db.insert(blockRecurrences).values({
      roomId,
      tag: 'Limpeza semanal',
      weekdays: [2],
      startMinute: 480,
      endMinute: 540,
      validFrom: '2026-10-20',
      validUntil: '2026-11-17',
      createdBy: admin.user.id,
    });
    await db.insert(jobRuns).values([
      { job: 'old', status: 'ok', startedAt: after(-31 * 24 * 60) },
      { job: 'recent', status: 'ok', startedAt: after(-29 * 24 * 60) },
    ]);

    const first = await materializeBlocks(depsAt(NOW), NOW);
    const second = await materializeBlocks(depsAt(NOW), NOW);

    // Tuesdays from the 20th to the 17th: 20/10, 27/10, 3/11, 10/11, 17/11.
    expect(first).toMatchObject({ blocksCreated: 5, blocksSkipped: 0, purgedJobRuns: 1 });
    expect(second).toMatchObject({ blocksCreated: 0, purgedJobRuns: 0 });
    expect((await db.select().from(jobRuns)).map((r) => r.job)).toEqual(['recent']);
  });
});
