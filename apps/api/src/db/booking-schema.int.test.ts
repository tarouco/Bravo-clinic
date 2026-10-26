import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createBooking, createCategory, createUser } from '../../test/factories';
import { requireTestDatabaseUrl } from '../../test/require-test-db';
import { createDb } from './client';
import { runMigrations } from './migrate';
import {
  bookingCategories,
  bookingEvents,
  bookingRescheduleRequests,
  bookings,
  rooms,
} from './schema';
import { runSeed } from './seed';

const testUrl = requireTestDatabaseUrl(process.env);
const { pool, db } = createDb(testUrl);

afterAll(async () => {
  await pool.end();
});

const NUCLEO_TABLES = [
  'booking_categories',
  'bookings',
  'booking_segments',
  'booking_events',
  'booking_reschedule_requests',
  'idempotency_keys',
  'payment_customers',
  'saved_cards',
  'charges',
  'refunds',
  'webhook_events',
  'job_runs',
];

async function sqlState(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    const err = error as { code?: string; cause?: { code?: string } };
    return err.code ?? err.cause?.code;
  }
  return undefined;
}

async function seededBooking(status = 'confirmed') {
  await runSeed(db);
  const [room] = await db.select().from(rooms).where(eq(rooms.slug, 'principal'));
  if (room === undefined) throw new Error('seed created no room');
  const user = await createUser(db);
  const booking = await createBooking(db, {
    userId: user.id,
    roomId: room.id,
    startsAt: new Date('2026-10-27T12:00:00Z'),
    endsAt: new Date('2026-10-27T14:00:00Z'),
    status,
  });
  return { room, user, booking };
}

describe('nucleo migrations (NUC-04, NUC-05)', () => {
  it('creates the nucleo tables and applies nothing when run a second time', async () => {
    const tables = await pool.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public'`,
    );
    const count = async () =>
      (
        await pool.query<{ n: string }>(
          `select count(*)::text as n from drizzle.__drizzle_migrations`,
        )
      ).rows[0]?.n;
    const before = await count();

    await runMigrations(testUrl);

    const present = tables.rows.map((row) => row.table_name);
    for (const table of NUCLEO_TABLES) expect(present).toContain(table);
    expect(await count()).toBe(before);
  });

  it('rejects a booking with an unknown status through the CHECK constraint', async () => {
    const { user, room } = await seededBooking();

    const state = await sqlState(
      createBooking(db, {
        userId: user.id,
        roomId: room.id,
        startsAt: new Date('2026-10-28T12:00:00Z'),
        endsAt: new Date('2026-10-28T13:00:00Z'),
        status: 'teleported',
      }),
    );

    expect(state).toBe('23514');
  });

  it('accepts each of the 11 documented booking statuses', async () => {
    const { user, room } = await seededBooking();
    const statuses = [
      'awaiting_payment',
      'pre_reserved',
      'held_for_renewal',
      'confirmed',
      'paid',
      'completed',
      'no_show',
      'expired',
      'cancelled_by_tenant',
      'cancelled_nonpayment',
      'cancelled_by_clinic',
    ];

    for (const [index, status] of statuses.entries()) {
      await createBooking(db, {
        userId: user.id,
        roomId: room.id,
        startsAt: new Date(Date.UTC(2026, 10, 3 + index, 12)),
        endsAt: new Date(Date.UTC(2026, 10, 3 + index, 13)),
        status,
      });
    }

    const stored = await db.select({ status: bookings.status }).from(bookings);
    expect(stored.map((row) => row.status).sort()).toEqual([...statuses, 'confirmed'].sort());
  });

  it('rejects a second is_reference category with a unique violation', async () => {
    await seededBooking();

    const state = await sqlState(createCategory(db, { name: 'Outra referência', isReference: true }));

    expect(state).toBe('23505');
  });

  it('rejects a reference category that is not hourly', async () => {
    await runSeed(db);
    await db.update(bookingCategories).set({ isReference: false });

    const state = await sqlState(
      createCategory(db, { type: 'block', isReference: true, name: 'Bloco referência' }),
    );

    expect(state).toBe('23514');
  });

  it('raises append_only_table on UPDATE and DELETE of booking_events', async () => {
    const { booking, user } = await seededBooking();
    await db.insert(bookingEvents).values({
      bookingId: booking.id,
      fromStatus: null,
      toStatus: 'confirmed',
      actorUserId: user.id,
      origin: 'app',
      reason: 'created',
    });

    await expect(pool.query(`update booking_events set reason = 'changed'`)).rejects.toThrow(
      'append_only_table',
    );
    await expect(pool.query(`delete from booking_events`)).rejects.toThrow('append_only_table');

    const rows = await db.select().from(bookingEvents);
    expect(rows.map((row) => row.reason)).toEqual(['created']);
  });

  it('rejects a second pending reschedule request for the same booking', async () => {
    const { booking, user, room } = await seededBooking();
    const request = {
      bookingId: booking.id,
      userId: user.id,
      newRoomId: room.id,
      newStartsAt: new Date('2026-10-28T12:00:00Z'),
      newEndsAt: new Date('2026-10-28T14:00:00Z'),
      quote: { netCents: 24000 },
      payNowCents: 14300,
      expiresAt: new Date('2026-10-20T12:15:00Z'),
    };
    await db.insert(bookingRescheduleRequests).values(request);

    const duplicate = await sqlState(db.insert(bookingRescheduleRequests).values(request));
    await db.update(bookingRescheduleRequests).set({ status: 'applied' });
    await db.insert(bookingRescheduleRequests).values(request);

    expect(duplicate).toBe('23505');
    const rows = await db.select({ status: bookingRescheduleRequests.status }).from(bookingRescheduleRequests);
    expect(rows.map((row) => row.status).sort()).toEqual(['applied', 'pending']);
  });

  it('rejects a duplicate payment-link hash and accepts many bookings without one', async () => {
    const { booking, user, room } = await seededBooking();
    await db.update(bookings).set({ paymentLinkTokenHash: 'hash-1' }).where(eq(bookings.id, booking.id));
    const other = await createBooking(db, {
      userId: user.id,
      roomId: room.id,
      startsAt: new Date('2026-10-29T12:00:00Z'),
      endsAt: new Date('2026-10-29T13:00:00Z'),
    });

    const state = await sqlState(
      db.update(bookings).set({ paymentLinkTokenHash: 'hash-1' }).where(eq(bookings.id, other.id)),
    );

    expect(state).toBe('23505');
  });
});

describe('category seed (design.md Seeds)', () => {
  it('inserts the 8 factory categories with names, types, windows, rates and one reference', async () => {
    await runSeed(db);

    const rows = await db.select().from(bookingCategories).orderBy(bookingCategories.displayOrder);
    expect(
      rows.map((r) => [
        r.displayOrder,
        r.name,
        r.type,
        r.startMinute,
        r.endMinute,
        r.weekdayRateCents ?? r.fixedPriceCents ?? r.pricePerOccurrenceCents,
        r.weekendRateCents,
        r.minDurationMinutes ?? r.includedMinutes,
        r.period,
        r.isReference,
      ]),
    ).toEqual([
      [1, '1 hora', 'hourly', 0, 1140, 9700, 12000, 60, 'single', true],
      [2, '2 horas ou mais', 'hourly', 0, 1140, 8000, 9900, 120, 'single', false],
      [3, '1 hora — noite', 'hourly', 1140, 1440, 12000, 12000, 60, 'single', false],
      [4, '2 horas ou mais — noite', 'hourly', 1140, 1440, 9900, 9900, 120, 'single', false],
      [5, 'Meio turno mensal', 'fixed_schedule', 420, 570, 28000, null, null, 'monthly', false],
      [6, 'Turno mensal', 'fixed_schedule', 420, 720, 50000, null, null, 'monthly', false],
      [7, 'Pacote 20h mensal', 'hour_package', 0, 1440, 160000, null, 1200, 'monthly', false],
      [8, 'Pacote 30h mensal', 'hour_package', 0, 1440, 240000, null, 1800, 'monthly', false],
    ]);
    expect(rows.every((r) => r.status === 'active' && r.visibility === 'public')).toBe(true);
  });

  it('keeps an edited price and adds nothing when the seed runs again', async () => {
    await runSeed(db);
    await db
      .update(bookingCategories)
      .set({ weekdayRateCents: 10000, version: 2 })
      .where(eq(bookingCategories.name, '1 hora'));

    await runSeed(db);

    const rows = await db.select().from(bookingCategories);
    expect(rows).toHaveLength(8);
    const hour = rows.find((r) => r.name === '1 hora');
    expect([hour?.weekdayRateCents, hour?.version]).toEqual([10000, 2]);
  });
});
