import { adminRescheduleResultSchema, localToUtc, type LocalDate } from '@bravo/core';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStaff, createTenant, seededRoom } from '../../../test/booking-helpers';
import { createBooking as insertBooking } from '../../../test/factories';
import { forbiddenFetch, send, testEnv } from '../../../test/http';
import { requireTestDatabaseUrl } from '../../../test/require-test-db';
import { createApp } from '../../app';
import { createDb } from '../../db/client';
import { auditLog, bookings } from '../../db/schema';
import { runSeed } from '../../db/seed';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

const NOW = new Date('2026-10-20T12:00:00.000Z');
const TUE = '2026-10-27' as LocalDate;
const WED = '2026-10-28' as LocalDate;
const at = (date: LocalDate, minute: number) => localToUtc(date, minute);

let roomId = '';

beforeEach(async () => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  await runSeed(db);
  roomId = (await seededRoom(db)).id;
});

const post = (cookie: string, id: string, body: Record<string, unknown>) =>
  send(
    createApp({ db, now: () => NOW, fetch: forbiddenFetch, env: testEnv() }),
    'POST',
    `/admin/bookings/${id}/reschedule`,
    { cookie, body },
  );

const customerBooking = async (overrides: Partial<Parameters<typeof insertBooking>[1]> = {}) => {
  const { user } = await createTenant(db, { now: NOW });
  return insertBooking(db, {
    userId: user.id,
    roomId,
    startsAt: at(TUE, 840),
    endsAt: at(TUE, 900),
    totalCents: 9700,
    paidCents: 4851,
    depositCents: 4851,
    ...overrides,
  });
};

const audits = async (action: string) =>
  (await db.select().from(auditLog)).filter((row) => row.action === action);

const wed3h = { date: WED, startMinute: 840, endMinute: 1020 };

describe('POST /admin/bookings/:id/reschedule (NUC-149)', () => {
  it('bypasses the policy with exception and a justification, and audits it (RS-5)', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    // Starts in 23 h and already used its free reschedule: a tenant would be refused twice.
    const row = await customerBooking({
      startsAt: new Date(NOW.getTime() + 23 * 3_600_000),
      endsAt: new Date(NOW.getTime() + 24 * 3_600_000),
    });
    await db.update(bookings).set({ rescheduleCount: 1 }).where(eq(bookings.id, row.id));
    const body = {
      date: '2026-12-21',
      startMinute: 840,
      endMinute: 900,
      exception: true,
      justification: 'Cliente com imprevisto médico',
    };

    const refused = await post(admin.cookie, row.id, { ...body, exception: false });
    const res = await post(admin.cookie, row.id, body);

    expect(refused.status).toBe(422);
    expect(refused.error?.code).toBe('POLICY_VIOLATION');
    expect(res.status).toBe(200);
    const detail = adminRescheduleResultSchema.parse(res.body);
    expect(detail.rescheduleCount).toBe(2);
    expect(detail.startsAt).toBe(at('2026-12-21', 840).toISOString());
    const [entry] = await audits('booking.reschedule_exception');
    expect(entry).toMatchObject({
      entityId: row.id,
      justification: 'Cliente com imprevisto médico',
      actorUserId: admin.user.id,
      origin: 'admin',
    });
  });

  it('waives the difference: the price stays, the waiver is audited with its amount', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const row = await customerBooking();

    const res = await post(admin.cookie, row.id, {
      ...wed3h,
      differenceHandling: 'waive',
      justification: 'Cortesia da clínica',
    });

    expect(res.status).toBe(200);
    const detail = adminRescheduleResultSchema.parse(res.body);
    expect(detail).toMatchObject({
      totalCents: 9700,
      paidCents: 4851,
      balanceCents: 4849,
      status: 'confirmed',
      creditCents: 0,
    });
    expect(detail.segments.map((s) => s.amountCents)).toEqual([24000]);
    const [entry] = await audits('booking.difference_waived');
    expect(entry).toMatchObject({ entityId: row.id, justification: 'Cortesia da clínica' });
    expect(entry?.after).toEqual({ differenceCents: 14300 });
  });

  it('adds the difference to the balance of a paid booking: it becomes confirmed with the schedule recomputed', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const row = await customerBooking({ status: 'paid', paidCents: 9700 });

    const res = await post(admin.cookie, row.id, {
      ...wed3h,
      differenceHandling: 'add_to_balance',
    });

    expect(res.status).toBe(200);
    const detail = adminRescheduleResultSchema.parse(res.body);
    expect(detail).toMatchObject({
      status: 'confirmed',
      totalCents: 24000,
      paidCents: 9700,
      balanceCents: 14300,
      depositCents: 4851,
    });
    const [stored] = await db.select().from(bookings).where(eq(bookings.id, row.id));
    expect(stored?.balanceChargeAt?.toISOString()).toBe(
      new Date(at(WED, 840).getTime() - 48 * 3_600_000).toISOString(),
    );
    expect(stored?.balanceDueAt?.toISOString()).toBe(
      new Date(at(WED, 840).getTime() - 24 * 3_600_000).toISOString(),
    );
  });

  it('asks how to handle a higher price when differenceHandling is missing', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const row = await customerBooking();

    const res = await post(admin.cookie, row.id, wed3h);

    expect(res.status).toBe(422);
    expect(res.error?.code).toBe('VALIDATION_FAILED');
    const [stored] = await db.select().from(bookings).where(eq(bookings.id, row.id));
    expect(stored?.rescheduleCount).toBe(0);
  });

  it('answers 403 to reception and 422 when the exception comes without a justification', async () => {
    const reception = await createStaff(db, 'reception', NOW);
    const admin = await createStaff(db, 'admin', NOW);
    const row = await customerBooking();

    const forbidden = await post(reception.cookie, row.id, {
      ...wed3h,
      differenceHandling: 'waive',
    });
    const unjustified = await post(admin.cookie, row.id, { ...wed3h, exception: true });

    expect(forbidden.status).toBe(403);
    expect(forbidden.error?.code).toBe('FORBIDDEN');
    expect(unjustified.status).toBe(422);
  });
});
