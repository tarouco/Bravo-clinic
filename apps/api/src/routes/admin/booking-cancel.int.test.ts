import {
  adminCancellationPreviewSchema,
  bookingDetailSchema,
  type ClinicCancelOption,
} from '@bravo/core';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCharge, createStaff, createTenant, seededRoom } from '../../../test/booking-helpers';
import { createBooking as insertBooking } from '../../../test/factories';
import { forbiddenFetch, send, testEnv } from '../../../test/http';
import { requireTestDatabaseUrl } from '../../../test/require-test-db';
import { createApp } from '../../app';
import { createDb } from '../../db/client';
import {
  auditLog,
  bookingEvents,
  bookings,
  charges,
  refunds,
  roomOccupancy,
} from '../../db/schema';
import { runSeed } from '../../db/seed';
import { createRegistry, type CreditPort, type Registry } from '../../extensions/registry';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

const NOW = new Date('2026-10-20T12:00:00.000Z');
const after = (hours: number) => new Date(NOW.getTime() + hours * 3_600_000);

let roomId = '';

beforeEach(async () => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  await runSeed(db);
  roomId = (await seededRoom(db)).id;
});

const buildApp = (override: Partial<Registry> = {}) =>
  createApp({
    db,
    now: () => NOW,
    fetch: forbiddenFetch,
    env: testEnv(),
    registry: createRegistry(override),
  });

const liveCredits = (grant: CreditPort['grant']): CreditPort => ({
  mode: 'live',
  availableCents: () => Promise.resolve(0),
  grant,
});

/** CA-9: 16000 paid in two charges, the clinic cancels 10 h before the start. */
async function paidBooking() {
  const { user } = await createTenant(db, { now: NOW });
  const row = await insertBooking(db, {
    userId: user.id,
    roomId,
    startsAt: after(10),
    endsAt: after(12),
    totalCents: 16000,
    depositCents: 8000,
    paidCents: 16000,
  });
  const deposit = await createCharge(db, {
    userId: user.id,
    bookingId: row.id,
    purpose: 'booking_deposit',
    amountCents: 8000,
    approvedAt: after(-100),
  });
  const balance = await createCharge(db, {
    userId: user.id,
    bookingId: row.id,
    purpose: 'booking_balance',
    amountCents: 8000,
    approvedAt: after(-2),
  });
  return { user, row, deposit, balance };
}

const cancel = (cookie: string, id: string, body: Record<string, unknown>, app = buildApp()) =>
  send(app, 'POST', `/admin/bookings/${id}/cancel`, { cookie, body });

describe('GET /admin/bookings/:id/cancellation-preview (NUC-153)', () => {
  it('returns CA-9 with the clinic options, leaving credit out until the port is live', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const { row } = await paidBooking();
    const path = `/admin/bookings/${row.id}/cancellation-preview`;

    const deferred = await send(buildApp(), 'GET', path, { cookie: admin.cookie });
    const live = await send(
      buildApp({ credits: liveCredits(() => Promise.resolve({ creditLotId: null })) }),
      'GET',
      path,
      { cookie: admin.cookie },
    );

    expect(adminCancellationPreviewSchema.parse(deferred.body)).toEqual({
      retainedCents: 0,
      refundCents: 16000,
      minutesReturned: 0,
      creditCents: 0,
      clinicOptions: ['refund', 'minutes'],
    });
    expect(adminCancellationPreviewSchema.parse(live.body).clinicOptions).toEqual([
      'refund',
      'minutes',
      'credit',
    ]);
  });
});

describe('POST /admin/bookings/:id/cancel (NUC-153)', () => {
  it('refunds everything paid, newest charge first, audits it and notifies the customer', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const { row, deposit, balance } = await paidBooking();

    const res = await cancel(admin.cookie, row.id, {
      reason: 'Sala em manutenção',
      resolution: 'refund',
      justification: 'Vazamento no teto',
    });

    expect(res.status).toBe(200);
    expect(bookingDetailSchema.parse(res.body).status).toBe('cancelled_by_clinic');
    const rows = await db.select().from(refunds);
    expect(rows.map((r) => [r.chargeId, r.amountCents, r.reason]).sort()).toEqual(
      [
        [balance.id, 8000, 'clinic_cancel'],
        [deposit.id, 8000, 'clinic_cancel'],
      ].sort(),
    );
    const [entry] = (await db.select().from(auditLog)).filter(
      (a) => a.action === 'booking.cancel_by_clinic',
    );
    expect(entry).toMatchObject({
      entityId: row.id,
      justification: 'Vazamento no teto',
      actorUserId: admin.user.id,
    });
    const [stored] = await db.select().from(bookings).where(eq(bookings.id, row.id));
    expect(stored).toMatchObject({
      status: 'cancelled_by_clinic',
      cancelReason: 'Sala em manutenção',
    });
  });

  it('refuses the credit resolution while the port is deferred and cancels nothing', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const { row } = await paidBooking();

    const res = await cancel(admin.cookie, row.id, { reason: 'Manutenção', resolution: 'credit' });

    expect(res.status).toBe(422);
    expect(res.error?.code).toBe('POLICY_VIOLATION');
    expect((await db.select().from(bookings).where(eq(bookings.id, row.id)))[0]?.status).toBe(
      'confirmed',
    );
    expect(await db.select().from(refunds)).toHaveLength(0);
  });

  it('grants 16000 through a live credit port instead of refunding', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const { row, user } = await paidBooking();
    const grant = vi.fn<CreditPort['grant']>(() => Promise.resolve({ creditLotId: 'lot-1' }));

    const res = await cancel(
      admin.cookie,
      row.id,
      { reason: 'Manutenção', resolution: 'credit' },
      buildApp({ credits: liveCredits(grant) }),
    );

    expect(res.status).toBe(200);
    expect(grant).toHaveBeenCalledTimes(1);
    expect(grant.mock.calls[0]?.[1]).toMatchObject({
      userId: user.id,
      amountCents: 16000,
      source: 'clinic_cancellation',
      refType: 'booking',
      refId: row.id,
    });
    expect(await db.select().from(refunds)).toHaveLength(0);
    const [event] = await db.select().from(bookingEvents);
    expect((event?.data as { creditGrant: unknown }).creditGrant).toEqual({
      amountCents: 16000,
      status: 'granted',
      creditLotId: 'lot-1',
    });
  });

  it('cancels a booking still awaiting payment: slot freed, pending charge cancelled, nothing refunded', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const { user } = await createTenant(db, { now: NOW });
    const row = await insertBooking(db, {
      userId: user.id,
      roomId,
      status: 'awaiting_payment',
      startsAt: after(30),
      endsAt: after(32),
      totalCents: 16000,
      depositCents: 8000,
      paidCents: 0,
      holdExpiresAt: after(0.25),
    });
    const pending = await createCharge(db, {
      userId: user.id,
      bookingId: row.id,
      purpose: 'booking_deposit',
      amountCents: 8000,
      status: 'pending',
      expiresAt: after(0.25),
    });

    const res = await cancel(admin.cookie, row.id, {
      reason: 'Sala em manutenção',
      resolution: 'refund',
    });

    expect(res.status).toBe(200);
    expect(bookingDetailSchema.parse(res.body).status).toBe('cancelled_by_clinic');
    const [stored] = await db.select().from(bookings).where(eq(bookings.id, row.id));
    expect(stored?.status).toBe('cancelled_by_clinic');
    const occupancy = await db.select().from(roomOccupancy).where(eq(roomOccupancy.refId, row.id));
    expect(occupancy).toHaveLength(1);
    expect(occupancy[0]?.active).toBe(false);
    const [charge] = await db.select().from(charges).where(eq(charges.id, pending.id));
    expect(charge?.status).toBe('cancelled');
    expect(await db.select().from(refunds)).toHaveLength(0);
    const [event] = await db
      .select()
      .from(bookingEvents)
      .where(eq(bookingEvents.bookingId, row.id));
    expect(event).toMatchObject({
      fromStatus: 'awaiting_payment',
      toStatus: 'cancelled_by_clinic',
    });
  });

  it('answers 422 for the minutes resolution on a booking paid in money, and 403 to reception', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const reception = await createStaff(db, 'reception', NOW);
    const { row } = await paidBooking();
    const resolution: ClinicCancelOption = 'minutes';

    const minutes = await cancel(admin.cookie, row.id, { reason: 'Manutenção', resolution });
    const forbidden = await cancel(reception.cookie, row.id, {
      reason: 'Manutenção',
      resolution: 'refund',
    });

    expect(minutes.status).toBe(422);
    expect(forbidden.status).toBe(403);
    expect(forbidden.error?.code).toBe('FORBIDDEN');
    expect((await db.select().from(bookings).where(eq(bookings.id, row.id)))[0]?.status).toBe(
      'confirmed',
    );
  });
});
