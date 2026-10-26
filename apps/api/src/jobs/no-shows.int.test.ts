import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTenant, seededRoom } from '../../test/booking-helpers';
import { createBooking as insertBooking } from '../../test/factories';
import { forbiddenFetch, testEnv } from '../../test/http';
import { requireTestDatabaseUrl } from '../../test/require-test-db';
import { createDb } from '../db/client';
import { bookingEvents, bookings } from '../db/schema';
import { runSeed } from '../db/seed';
import { createRegistry } from '../extensions/registry';
import { noShows } from './no-shows';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

const MINUTE = 60_000;
const START = new Date('2026-10-27T17:00:00.000Z');
const at = (minutesAfterStart: number) => new Date(START.getTime() + minutesAfterStart * MINUTE);

let roomId = '';

beforeEach(async () => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  await runSeed(db);
  roomId = (await seededRoom(db)).id;
});

const run = (now: Date) =>
  noShows(
    { db, env: testEnv(), fetch: forbiddenFetch, now: () => now, registry: createRegistry() },
    now,
  );

async function booking(
  overrides: Partial<Parameters<typeof insertBooking>[1]> & { checkedIn?: boolean } = {},
) {
  const { user } = await createTenant(db);
  const { checkedIn, ...rest } = overrides;
  const row = await insertBooking(db, {
    userId: user.id,
    roomId,
    startsAt: START,
    endsAt: new Date(START.getTime() + 60 * MINUTE),
    ...rest,
  });
  if (checkedIn === true) {
    await db.update(bookings).set({ checkedInAt: START }).where(eq(bookings.id, row.id));
  }
  return row;
}

const statusOf = async (id: string) =>
  (await db.select().from(bookings).where(eq(bookings.id, id)))[0]?.status;

describe('no-shows (NUC-168)', () => {
  it('marks no_show 31 min after the start without check-in, frees the slot and keeps 29 min untouched', async () => {
    const absent = await booking();
    const stats29 = await run(at(29));
    const stats31 = await run(at(31));

    expect(stats29).toMatchObject({ noShow: 0, completed: 0 });
    expect(stats31).toMatchObject({ noShow: 1 });
    expect(await statusOf(absent.id)).toBe('no_show');
    const { rows } = await pool.query(`select 1 from room_occupancy where ref_id = $1 and active`, [
      absent.id,
    ]);
    expect(rows).toHaveLength(0);
    const events = await db.select().from(bookingEvents);
    expect(events[0]).toMatchObject({
      fromStatus: 'confirmed',
      toStatus: 'no_show',
      origin: 'job',
    });
  });

  it('does not touch the booking at 29 min', async () => {
    const waiting = await booking();

    await run(at(29));

    expect(await statusOf(waiting.id)).toBe('confirmed');
  });

  it('completes a checked-in booking once it has ended, not before', async () => {
    const attended = await booking({ checkedIn: true, status: 'paid' });

    const during = await run(at(45));
    const ended = await run(at(61));

    expect(during).toMatchObject({ completed: 0, noShow: 0 });
    expect(ended).toMatchObject({ completed: 1, noShow: 0 });
    expect(await statusOf(attended.id)).toBe('completed');
  });

  it('is safe to run twice', async () => {
    await booking();

    const first = await run(at(40));
    const second = await run(at(41));

    expect(first).toMatchObject({ noShow: 1 });
    expect(second).toMatchObject({ noShow: 0 });
    expect(await db.select().from(bookingEvents)).toHaveLength(1);
  });
});
