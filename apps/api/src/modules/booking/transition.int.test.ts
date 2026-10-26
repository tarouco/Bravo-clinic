import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createBooking, createUser } from '../../../test/factories';
import { requireTestDatabaseUrl } from '../../../test/require-test-db';
import { createDb, withTransaction } from '../../db/client';
import { bookingEvents, bookings, roomOccupancy, rooms } from '../../db/schema';
import { runSeed } from '../../db/seed';
import type { RequestContext } from '../../lib/audit';
import { transitionBooking } from './transition';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

const STARTS = new Date('2026-10-27T13:00:00.000Z');
const ENDS = new Date('2026-10-27T15:00:00.000Z');
let roomId = '';

beforeEach(async () => {
  await runSeed(db);
  const [room] = await db.select().from(rooms).limit(1);
  roomId = room?.id ?? '';
});

async function bookingIn(status: string) {
  const user = await createUser(db, { role: 'admin', email: 'adm@bravoclinic.test' });
  const booking = await createBooking(db, {
    userId: user.id,
    roomId,
    startsAt: STARTS,
    endsAt: ENDS,
    status,
  });
  const ctx: RequestContext = {
    actorUserId: user.id,
    actorRole: 'admin',
    origin: 'admin',
    ip: null,
    requestId: null,
  };
  return { booking, ctx };
}

const occupancyOf = async (bookingId: string) =>
  (await db.select().from(roomOccupancy).where(eq(roomOccupancy.refId, bookingId)))[0];

describe('transitionBooking (NUC-05, NUC-06)', () => {
  it('moves the booking, applies the patch and appends an event with actor, origin, reason and data', async () => {
    const { booking, ctx } = await bookingIn('awaiting_payment');

    const updated = await withTransaction(db, (tx) =>
      transitionBooking(
        tx,
        ctx,
        booking.id,
        ['awaiting_payment', 'pre_reserved'],
        'confirmed',
        'manual_confirmation',
        { note: 'balcão' },
        { paidCents: 5000, balanceCents: 4700 },
      ),
    );

    expect(updated).toMatchObject({ status: 'confirmed', paidCents: 5000, balanceCents: 4700 });
    const [event] = await db.select().from(bookingEvents);
    expect(event).toMatchObject({
      bookingId: booking.id,
      fromStatus: 'awaiting_payment',
      toStatus: 'confirmed',
      actorUserId: ctx.actorUserId,
      origin: 'admin',
      reason: 'manual_confirmation',
      data: { note: 'balcão' },
    });
    expect((await occupancyOf(booking.id))?.active).toBe(true);
  });

  it('answers 409 INVALID_TRANSITION for a pair outside the state machine and writes nothing', async () => {
    const { booking, ctx } = await bookingIn('confirmed');

    await expect(
      withTransaction(db, (tx) =>
        transitionBooking(tx, ctx, booking.id, ['confirmed'], 'awaiting_payment', 'oops'),
      ),
    ).rejects.toMatchObject({
      status: 409,
      code: 'INVALID_TRANSITION',
      details: { from: 'confirmed', to: 'awaiting_payment' },
    });
    expect(await db.select().from(bookingEvents)).toHaveLength(0);
    expect((await db.select().from(bookings))[0]?.status).toBe('confirmed');
  });

  it('answers 409 when the current status is not in the expected from list', async () => {
    const { booking, ctx } = await bookingIn('paid');

    await expect(
      withTransaction(db, (tx) =>
        transitionBooking(tx, ctx, booking.id, ['awaiting_payment'], 'expired', 'job'),
      ),
    ).rejects.toMatchObject({ status: 409, code: 'INVALID_TRANSITION' });
  });

  it('answers 404 for an unknown booking', async () => {
    const { ctx } = await bookingIn('confirmed');

    await expect(
      withTransaction(db, (tx) =>
        transitionBooking(
          tx,
          ctx,
          '00000000-0000-4000-8000-000000000000',
          ['confirmed'],
          'paid',
          'x',
        ),
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('deactivates the occupancy when the booking enters a terminal state', async () => {
    const { booking, ctx } = await bookingIn('confirmed');

    await withTransaction(db, (tx) =>
      transitionBooking(
        tx,
        ctx,
        booking.id,
        ['confirmed'],
        'cancelled_by_clinic',
        'clinic',
        undefined,
        {
          cancelledAt: new Date('2026-10-20T12:00:00.000Z'),
        },
      ),
    );

    expect((await occupancyOf(booking.id))?.active).toBe(false);
    expect((await db.select().from(bookings))[0]).toMatchObject({
      status: 'cancelled_by_clinic',
      cancelledAt: new Date('2026-10-20T12:00:00.000Z'),
    });
  });

  it('rolls the whole transition back with the caller’s transaction', async () => {
    const { booking, ctx } = await bookingIn('confirmed');

    await expect(
      withTransaction(db, async (tx) => {
        await transitionBooking(tx, ctx, booking.id, ['confirmed'], 'paid', 'balance');
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');

    expect((await db.select().from(bookings))[0]?.status).toBe('confirmed');
    expect(await db.select().from(bookingEvents)).toHaveLength(0);
  });
});
