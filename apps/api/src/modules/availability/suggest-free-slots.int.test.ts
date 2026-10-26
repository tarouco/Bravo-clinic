import { utcToLocal } from '@bravo/core';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createBooking, createUser } from '../../../test/factories';
import { requireTestDatabaseUrl } from '../../../test/require-test-db';
import { createDb } from '../../db/client';
import { rooms } from '../../db/schema';
import { runSeed } from '../../db/seed';
import { suggestFreeSlots } from './availability.service';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

const NOW = new Date('2026-10-20T12:00:00.000Z');
let roomId = '';

beforeEach(async () => {
  await runSeed(db);
  const [room] = await db.select().from(rooms).limit(1);
  roomId = room?.id ?? '';
});

const args = (overrides: Partial<Parameters<typeof suggestFreeSlots>[1]> = {}) => ({
  roomId,
  durationMinutes: 120,
  from: NOW,
  days: 14,
  count: 3,
  ...overrides,
});

describe('suggestFreeSlots (NUC-117)', () => {
  it('offers three slots of the requested duration on three different days, all in the future', async () => {
    const slots = await suggestFreeSlots(db, args());

    expect(slots).toHaveLength(3);
    for (const slot of slots) {
      expect(slot.endsAt.getTime() - slot.startsAt.getTime()).toBe(120 * 60_000);
      expect(slot.startsAt.getTime()).toBeGreaterThan(NOW.getTime());
    }
    const days = slots.map((s) => utcToLocal(s.startsAt).date);
    expect(new Set(days).size).toBe(3);
  });

  it('never offers a slot that overlaps a booking or its cleanup', async () => {
    const [first] = await suggestFreeSlots(db, args({ count: 1 }));
    if (first === undefined) throw new Error('no slot to take');
    const user = await createUser(db, { email: 'ana@bravoclinic.test' });
    await createBooking(db, {
      userId: user.id,
      roomId,
      startsAt: first.startsAt,
      endsAt: first.endsAt,
      cleanupMinutes: 30,
    });

    const slots = await suggestFreeSlots(db, args());

    for (const slot of slots) {
      const clash =
        slot.startsAt < new Date(first.endsAt.getTime() + 30 * 60_000) &&
        slot.endsAt > first.startsAt;
      expect(clash).toBe(false);
    }
    expect(slots).toHaveLength(3);
  });

  it('stays inside the horizon, and returns nothing for an unknown room', async () => {
    const today = await suggestFreeSlots(db, args({ days: 0, count: 50 }));
    expect(today.length).toBeGreaterThan(0);
    expect(today.length).toBeLessThan(50);
    expect(new Set(today.map((s) => utcToLocal(s.startsAt).date))).toEqual(
      new Set([utcToLocal(NOW).date]),
    );
    expect(
      await suggestFreeSlots(db, args({ roomId: '00000000-0000-4000-8000-000000000000' })),
    ).toEqual([]);
  });

  it('adds more slots of the same days once every day has offered one', async () => {
    const slots = await suggestFreeSlots(db, args({ days: 1, count: 4 }));

    expect(slots).toHaveLength(4);
    const days = new Set(slots.map((s) => utcToLocal(s.startsAt).date));
    expect(days.size).toBeLessThanOrEqual(2);
  });
});
