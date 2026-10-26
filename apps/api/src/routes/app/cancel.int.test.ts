import { randomUUID } from 'node:crypto';
import {
  bookingDetailSchema,
  cancellationPreviewSchema,
  policySnapshot,
  settingDefaults,
  type CancellationResult,
} from '@bravo/core';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCharge, createTenant, seededRoom } from '../../../test/booking-helpers';
import { createBooking as insertBooking } from '../../../test/factories';
import { forbiddenFetch, send, testEnv } from '../../../test/http';
import { requireTestDatabaseUrl } from '../../../test/require-test-db';
import { createApp } from '../../app';
import { createDb, withTransaction } from '../../db/client';
import {
  blocks,
  bookingEvents,
  bookingRescheduleRequests,
  bookings,
  charges,
  emailOutbox,
  refunds,
} from '../../db/schema';
import { runSeed } from '../../db/seed';
import { createRegistry, type CheckoutStep, type Registry } from '../../extensions/registry';
import { saveSetting } from '../../modules/settings/settings.repo';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

const NOW = new Date('2026-10-20T12:00:00.000Z');
const HOUR = 3_600_000;
const after = (hours: number) => new Date(NOW.getTime() + hours * HOUR);

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

/** W-CA shape: deposit 8000 on a 16000 booking that starts `hours` from now. */
const bookingIn = (
  userId: string,
  hours: number,
  overrides: Partial<Parameters<typeof insertBooking>[1]> = {},
) =>
  insertBooking(db, {
    userId,
    roomId,
    startsAt: after(hours),
    endsAt: after(hours + 2),
    totalCents: 16000,
    depositCents: 8000,
    paidCents: 16000,
    ...overrides,
  });

const preview = (cookie: string, id: string) =>
  send(buildApp(), 'GET', `/app/bookings/${id}/cancellation-preview`, { cookie });

const cancel = (cookie: string, id: string, body: Record<string, unknown> = {}, app = buildApp()) =>
  send(app, 'POST', `/app/bookings/${id}/cancel`, {
    cookie,
    body,
    headers: { 'Idempotency-Key': randomUUID() },
  });

describe('GET /app/bookings/:id/cancellation-preview (NUC-150)', () => {
  it('equals W-CA CA-1..CA-4 for seeded bookings', async () => {
    const { user, cookie } = await createTenant(db, { now: NOW });
    // They overlap in time, which only matters for the occupancy these previews never read.
    const ca1 = await bookingIn(user.id, 30, { occupancy: false });
    const ca2 = await bookingIn(user.id, 30, { paidCents: 8000, occupancy: false });
    const ca3 = await bookingIn(user.id, 23, { occupancy: false });
    const ca4 = await bookingIn(user.id, 24, { occupancy: false });

    const results = [];
    for (const row of [ca1, ca2, ca3, ca4]) {
      results.push(cancellationPreviewSchema.parse((await preview(cookie, row.id)).body));
    }

    expect(results).toEqual([
      { retainedCents: 8000, refundCents: 8000, minutesReturned: 0, creditCents: 0 },
      { retainedCents: 8000, refundCents: 0, minutesReturned: 0, creditCents: 0 },
      { retainedCents: 16000, refundCents: 0, minutesReturned: 0, creditCents: 0 },
      { retainedCents: 8000, refundCents: 8000, minutesReturned: 0, creditCents: 0 },
    ]);
  });

  it('keeps the policy frozen on the booking: deposit_refundable at creation wins over today’s setting (CA-10)', async () => {
    const { user, cookie } = await createTenant(db, { now: NOW });
    const row = await bookingIn(user.id, 30);
    await db
      .update(bookings)
      .set({
        policySnapshot: {
          ...policySnapshot(settingDefaults()),
          'payment.deposit_refundable': true,
        },
      })
      .where(eq(bookings.id, row.id));
    await withTransaction(db, (tx) => saveSetting(tx, 'payment.deposit_refundable', false, null));

    const result = cancellationPreviewSchema.parse((await preview(cookie, row.id)).body);

    expect(result).toEqual({
      retainedCents: 0,
      refundCents: 16000,
      minutesReturned: 0,
      creditCents: 0,
    });
  });

  it('answers 404 for another user’s booking and 409 for a booking that cannot be cancelled', async () => {
    const owner = await createTenant(db, { now: NOW });
    const other = await createTenant(db, { now: NOW });
    const active = await bookingIn(owner.user.id, 30);
    const done = await bookingIn(owner.user.id, -5, { status: 'completed' });

    const foreign = await preview(other.cookie, active.id);
    const finished = await preview(owner.cookie, done.id);

    expect(foreign.status).toBe(404);
    expect(finished.status).toBe(409);
    expect(finished.error?.code).toBe('INVALID_TRANSITION');
  });
});

describe('POST /app/bookings/:id/cancel (NUC-151, NUC-152, NUC-205, NUC-210)', () => {
  it('cancels CA-1: refunds 8000 on the newest charge, frees the slot and mails METHOD:CANCEL', async () => {
    const { user, cookie } = await createTenant(db, { now: NOW });
    const row = await bookingIn(user.id, 30);
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
    const notifyStaff = vi.fn(() => Promise.resolve());

    const res = await cancel(
      cookie,
      row.id,
      { reason: 'Imprevisto' },
      buildApp({ notifications: { notifyStaff } }),
    );

    expect(res.status).toBe(200);
    const detail = bookingDetailSchema.parse(res.body);
    expect(detail.status).toBe('cancelled_by_tenant');
    const [stored] = await db.select().from(bookings).where(eq(bookings.id, row.id));
    expect(stored).toMatchObject({
      status: 'cancelled_by_tenant',
      cancelReason: 'Imprevisto',
      cancelledBy: user.id,
      icsSequence: 1,
    });
    expect(stored?.cancelledAt?.toISOString()).toBe(NOW.toISOString());
    const rows = await db.select().from(refunds);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      chargeId: balance.id,
      amountCents: 8000,
      reason: 'tenant_cancel',
      bookingId: row.id,
    });
    expect(rows[0]?.chargeId).not.toBe(deposit.id);
    const { rows: active } = await pool.query(
      `select 1 from room_occupancy where ref_id = $1 and active`,
      [row.id],
    );
    expect(active).toHaveLength(0);
    const [mail] = await db.select().from(emailOutbox);
    expect(mail?.template).toBe('booking.cancelled');
    const attachment = (mail?.attachments as { contentBase64: string }[])[0];
    expect(Buffer.from(attachment?.contentBase64 ?? '', 'base64').toString('utf8')).toContain(
      'METHOD:CANCEL',
    );
    expect(notifyStaff).toHaveBeenCalledWith(
      'booking_cancelled',
      expect.objectContaining({ entityId: row.id }),
    );
    const events = await db.select().from(bookingEvents);
    expect(events[0]).toMatchObject({ fromStatus: 'confirmed', toStatus: 'cancelled_by_tenant' });
  });

  it('hands the cancellation result to a checkout step’s release hook (CA-1: refundCents 8000)', async () => {
    const { user, cookie } = await createTenant(db, { now: NOW });
    const row = await bookingIn(user.id, 30);
    await createCharge(db, {
      userId: user.id,
      bookingId: row.id,
      purpose: 'booking_deposit',
      amountCents: 16000,
    });
    const received: { reason: string; result: CancellationResult | undefined }[] = [];
    const step: CheckoutStep = {
      name: 'probe',
      order: 500,
      apply: (_ctx, draft) => Promise.resolve(draft),
      release: (_tx, _booking, reason, result) => {
        received.push({ reason, result });
        return Promise.resolve();
      },
    };

    const res = await cancel(cookie, row.id, {}, buildApp({ checkoutSteps: [step] }));

    expect(res.status).toBe(200);
    expect(received).toHaveLength(1);
    expect(received[0]?.reason).toBe('cancelled');
    expect(received[0]?.result).toMatchObject({ refundCents: 8000, retainedCents: 8000 });
  });

  it('refunds nothing at 23 h before (CA-3) and keeps everything paid', async () => {
    const { user, cookie } = await createTenant(db, { now: NOW });
    const row = await bookingIn(user.id, 23);
    await createCharge(db, {
      userId: user.id,
      bookingId: row.id,
      purpose: 'booking_deposit',
      amountCents: 16000,
    });

    const res = await cancel(cookie, row.id);

    expect(res.status).toBe(200);
    expect(await db.select().from(refunds)).toHaveLength(0);
    expect((await db.select().from(bookings).where(eq(bookings.id, row.id)))[0]?.paidCents).toBe(
      16000,
    );
  });

  it('cancels an awaiting_payment booking without a refund and cancels its pending charge', async () => {
    const { user, cookie } = await createTenant(db, { now: NOW });
    const row = await bookingIn(user.id, 30, {
      status: 'awaiting_payment',
      paidCents: 0,
      holdExpiresAt: after(0.2),
    });
    const pending = await createCharge(db, {
      userId: user.id,
      bookingId: row.id,
      purpose: 'booking_deposit',
      amountCents: 8000,
      status: 'pending',
      externalId: null,
    });

    const res = await cancel(cookie, row.id);

    expect(res.status).toBe(200);
    expect(bookingDetailSchema.parse(res.body).status).toBe('cancelled_by_tenant');
    expect(await db.select().from(refunds)).toHaveLength(0);
    const [charge] = await db.select().from(charges).where(eq(charges.id, pending.id));
    expect(charge?.status).toBe('cancelled');
  });

  it('cancels a pending reschedule request with the booking, freeing its hold block', async () => {
    const { user, cookie } = await createTenant(db, { now: NOW });
    const row = await bookingIn(user.id, 30, {
      totalCents: 9700,
      depositCents: 4851,
      paidCents: 4851,
    });
    const moved = await send(buildApp(), 'POST', `/app/bookings/${row.id}/reschedule`, {
      cookie,
      body: { date: '2026-10-28', startMinute: 840, endMinute: 1020, method: 'pix' },
      headers: { 'Idempotency-Key': randomUUID() },
    });
    expect(moved.status).toBe(202);

    const res = await cancel(cookie, row.id);

    expect(res.status).toBe(200);
    const [request] = await db.select().from(bookingRescheduleRequests);
    expect(request?.status).toBe('cancelled');
    expect((await db.select().from(blocks))[0]?.cancelledAt).not.toBeNull();
    expect(
      (await db.select().from(charges).where(eq(charges.purpose, 'booking_difference')))[0]?.status,
    ).toBe('cancelled');
  });

  it('answers 422 unsupported_payment_mode for a package booking without a handler and 404 for a stranger', async () => {
    const owner = await createTenant(db, { now: NOW });
    const other = await createTenant(db, { now: NOW });
    const pkg = await bookingIn(owner.user.id, 30, { paymentMode: 'package', paidCents: 0 });
    const plain = await bookingIn(owner.user.id, 60);

    const unsupported = await cancel(owner.cookie, pkg.id);
    const stranger = await cancel(other.cookie, plain.id);

    expect(unsupported.status).toBe(422);
    expect(unsupported.error?.code).toBe('POLICY_VIOLATION');
    expect((unsupported.error?.details as unknown as { reason: string }).reason).toBe(
      'unsupported_payment_mode',
    );
    expect(stranger.status).toBe(404);
  });
});
