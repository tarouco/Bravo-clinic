import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCharge, createTenant, seededRoom } from '../../test/booking-helpers';
import { createBooking as insertBooking } from '../../test/factories';
import { forbiddenFetch, testEnv } from '../../test/http';
import { requireTestDatabaseUrl } from '../../test/require-test-db';
import { createDb } from '../db/client';
import { emailOutbox } from '../db/schema';
import { runSeed } from '../db/seed';
import { createRegistry } from '../extensions/registry';
import { reminders } from './reminders';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

const HOUR = 3_600_000;
const START = new Date('2026-10-27T17:00:00.000Z');
/** The instant that is `hours` before START. */
const before = (hours: number) => new Date(START.getTime() - hours * HOUR);

let roomId = '';

beforeEach(async () => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  await runSeed(db);
  roomId = (await seededRoom(db)).id;
});

const run = (now: Date) =>
  reminders(
    { db, env: testEnv(), fetch: forbiddenFetch, now: () => now, registry: createRegistry() },
    now,
  );

const outbox = async () =>
  (await db.select().from(emailOutbox).orderBy(emailOutbox.createdAt)).map(
    (m) => [m.template, m.dedupeKey] as const,
  );

async function bookingStarting(overrides: Partial<Parameters<typeof insertBooking>[1]> = {}) {
  const { user } = await createTenant(db);
  return {
    user,
    booking: await insertBooking(db, {
      userId: user.id,
      roomId,
      startsAt: START,
      endsAt: new Date(START.getTime() + 2 * HOUR),
      totalCents: 16000,
      depositCents: 8000,
      paidCents: 8000,
      balanceDueAt: before(24),
      ...overrides,
    }),
  };
}

describe('reminders: balance (NUC-133)', () => {
  it('sends one reminder per configured hour (48, 36, 26) over repeated runs', async () => {
    const { user, booking } = await bookingStarting();
    await createCharge(db, {
      userId: user.id,
      bookingId: booking.id,
      purpose: 'booking_balance',
      amountCents: 8000,
      status: 'pending',
    });

    const marks = [
      before(50),
      before(48),
      before(48),
      before(40),
      before(36),
      before(30),
      before(26),
      before(25),
    ];
    for (const now of marks) await run(now);
    await run(before(26));

    expect(await outbox()).toEqual([
      ['booking.balance_reminder', `balance_reminder:${booking.id}:48`],
      ['booking.balance_reminder', `balance_reminder:${booking.id}:36`],
      ['booking.balance_reminder', `balance_reminder:${booking.id}:26`],
    ]);
  });

  it('sends none when no Pix balance is pending or the booking is cancelled', async () => {
    const noCharge = await bookingStarting();
    const cancelled = await bookingStarting({ status: 'cancelled_by_tenant' });
    await createCharge(db, {
      userId: cancelled.user.id,
      bookingId: cancelled.booking.id,
      purpose: 'booking_balance',
      amountCents: 8000,
      status: 'pending',
    });

    const stats = await run(before(40));

    expect(stats).toMatchObject({ balanceReminders: 0 });
    expect(await outbox()).toEqual([]);
    expect(noCharge.booking.id).not.toBe(cancelled.booking.id);
  });
});

describe('reminders: booking (NUC-138)', () => {
  it('sends the 24 h and the 2 h reminder once each, and nothing for a cancelled booking', async () => {
    const { booking } = await bookingStarting({ status: 'paid', paidCents: 16000 });
    await bookingStarting({ status: 'cancelled_by_tenant', occupancy: false });

    await run(before(24));
    await run(before(24));
    await run(before(12));
    await run(before(2));
    await run(before(2));
    await run(before(1));

    expect(await outbox()).toEqual([
      ['booking.reminder_24h', `booking_reminder:${booking.id}:24`],
      ['booking.reminder_2h', `booking_reminder:${booking.id}:2`],
    ]);
  });

  it('does not send the 24 h reminder for a booking made less than 23 h before its start', async () => {
    await bookingStarting();

    await run(before(20));

    expect(await outbox()).toEqual([]);
  });
});
