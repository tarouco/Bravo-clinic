import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCharge, createTenant, seededRoom } from '../../test/booking-helpers';
import { createBooking as insertBooking } from '../../test/factories';
import { forbiddenFetch, testEnv } from '../../test/http';
import { requireTestDatabaseUrl } from '../../test/require-test-db';
import { createDb } from '../db/client';
import { bookings, charges, emailOutbox, refunds } from '../db/schema';
import { runSeed } from '../db/seed';
import { createRegistry, type Registry } from '../extensions/registry';
import { createSandboxGateway } from '../payments/adapters/sandbox';
import type { NormalizedStatus, PaymentGateway } from '../payments/gateway';
import { reconcilePayments } from './reconcile-payments';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

const MINUTE = 60_000;
const NOW = new Date('2026-10-20T12:00:00.000Z');
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * MINUTE);

let roomId = '';

beforeEach(async () => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  await runSeed(db);
  roomId = (await seededRoom(db)).id;
});

/** A sandbox gateway whose `getStatus` answers with the given status. */
function gatewayAnswering(status: NormalizedStatus | null): PaymentGateway {
  const sandbox = createSandboxGateway({ env: testEnv() });
  return {
    ...sandbox,
    getStatus: (ref) =>
      Promise.resolve(
        status === null
          ? null
          : { externalId: ref.externalId, status, feeCents: 0, raw: { stub: true } },
      ),
  };
}

const run = (answer: NormalizedStatus | null, override: Partial<Registry> = {}) =>
  reconcilePayments(
    {
      db,
      env: testEnv(),
      fetch: forbiddenFetch,
      now: () => NOW,
      registry: createRegistry(override),
      gatewayFor: () => Promise.resolve(gatewayAnswering(answer)),
    },
    NOW,
  );

async function awaitingBooking() {
  const { user } = await createTenant(db);
  const booking = await insertBooking(db, {
    userId: user.id,
    roomId,
    startsAt: new Date('2026-10-27T17:00:00.000Z'),
    endsAt: new Date('2026-10-27T19:00:00.000Z'),
    status: 'awaiting_payment',
    totalCents: 9700,
    depositCents: 4851,
    paidCents: 0,
    holdExpiresAt: new Date(NOW.getTime() + 10 * MINUTE),
  });
  return { user, booking };
}

describe('reconcile-payments: charges (NUC-198)', () => {
  it('applies an approved status found at the provider exactly like the webhook path', async () => {
    const { user, booking } = await awaitingBooking();
    const charge = await createCharge(db, {
      userId: user.id,
      bookingId: booking.id,
      purpose: 'booking_deposit',
      amountCents: 4851,
      status: 'pending',
      createdAt: ago(3),
      expiresAt: new Date(NOW.getTime() + 10 * MINUTE),
    });
    const notifyStaff = vi.fn(() => Promise.resolve());

    const stats = await run('approved', { notifications: { notifyStaff } });

    expect(stats).toMatchObject({ applied: 1, refreshed: 0 });
    const [stored] = await db.select().from(bookings).where(eq(bookings.id, booking.id));
    expect(stored).toMatchObject({ status: 'confirmed', paidCents: 4851, balanceCents: 4849 });
    const [paid] = await db.select().from(charges).where(eq(charges.id, charge.id));
    expect(paid).toMatchObject({ status: 'approved', feeCents: 0 });
    expect(paid?.approvedAt).not.toBeNull();
    expect((await db.select().from(emailOutbox)).map((m) => m.template)).toEqual([
      'booking.confirmed',
    ]);
    expect(notifyStaff).toHaveBeenCalledWith(
      'new_booking',
      expect.objectContaining({ entityId: booking.id }),
    );
  });

  it('leaves a charge younger than 2 minutes alone and keeps one the provider still shows pending', async () => {
    const { user, booking } = await awaitingBooking();
    const fresh = await createCharge(db, {
      userId: user.id,
      bookingId: booking.id,
      purpose: 'booking_deposit',
      amountCents: 4851,
      status: 'pending',
      createdAt: ago(1),
    });
    const waiting = await createCharge(db, {
      userId: user.id,
      bookingId: booking.id,
      purpose: 'booking_balance',
      amountCents: 4849,
      status: 'pending',
      createdAt: ago(5),
      expiresAt: new Date(NOW.getTime() + 60 * MINUTE),
    });

    // The stub would approve anything it is asked about; only the older charge is asked.
    const stats = await run('pending');

    expect(stats).toMatchObject({ refreshed: 1, applied: 0, expired: 0 });
    expect((await db.select().from(charges).where(eq(charges.id, fresh.id)))[0]?.status).toBe(
      'pending',
    );
    expect((await db.select().from(charges).where(eq(charges.id, waiting.id)))[0]?.status).toBe(
      'pending',
    );
  });

  it('expires a charge past its expires_at that the provider still shows pending', async () => {
    const { user, booking } = await awaitingBooking();
    const old = await createCharge(db, {
      userId: user.id,
      bookingId: booking.id,
      purpose: 'booking_deposit',
      amountCents: 4851,
      status: 'pending',
      createdAt: ago(30),
      expiresAt: ago(15),
    });

    const stats = await run('pending');

    expect(stats).toMatchObject({ expired: 1, applied: 0 });
    expect((await db.select().from(charges).where(eq(charges.id, old.id)))[0]?.status).toBe(
      'expired',
    );
  });

  it('cancels a pending charge without provider id older than 10 min, not one of 9 min', async () => {
    const { user, booking } = await awaitingBooking();
    const stale = await createCharge(db, {
      userId: user.id,
      bookingId: booking.id,
      purpose: 'booking_deposit',
      amountCents: 4851,
      status: 'pending',
      externalId: null,
      createdAt: ago(11),
    });
    const young = await createCharge(db, {
      userId: user.id,
      bookingId: booking.id,
      purpose: 'booking_balance',
      amountCents: 4849,
      status: 'pending',
      externalId: null,
      createdAt: ago(9),
    });

    const stats = await run(null);

    expect(stats).toMatchObject({ cancelledStale: 1 });
    expect((await db.select().from(charges).where(eq(charges.id, stale.id)))[0]?.status).toBe(
      'cancelled',
    );
    expect((await db.select().from(charges).where(eq(charges.id, young.id)))[0]?.status).toBe(
      'pending',
    );
  });
});

describe('reconcile-payments: refunds (NUC-119, NUC-198)', () => {
  it('fails a refund after its fifth failed attempt and raises payment_issue', async () => {
    const { user, booking } = await awaitingBooking();
    // No provider id: the gateway refund cannot even be attempted, so each run counts a failure.
    const charge = await createCharge(db, {
      userId: user.id,
      bookingId: booking.id,
      purpose: 'booking_deposit',
      amountCents: 4851,
      externalId: null,
    });
    const [refund] = await db
      .insert(refunds)
      .values({
        chargeId: charge.id,
        bookingId: booking.id,
        provider: 'sandbox',
        amountCents: 4851,
        reason: 'manual',
        status: 'pending',
        attempts: 4,
      })
      .returning();
    const notifyStaff = vi.fn(() => Promise.resolve());

    const stats = await run(null, { notifications: { notifyStaff } });

    expect(stats).toMatchObject({ refundsProcessed: 1, refundsFailed: 1 });
    const [after] = await db
      .select()
      .from(refunds)
      .where(eq(refunds.id, refund?.id ?? ''));
    expect(after).toMatchObject({ status: 'failed', attempts: 5 });
    expect(after?.lastError).toBeTruthy();
    expect(notifyStaff).toHaveBeenCalledWith(
      'payment_issue',
      expect.objectContaining({ entityId: refund?.id }),
    );
  });

  it('retries a pending refund below five attempts and completes it', async () => {
    const { user, booking } = await awaitingBooking();
    const charge = await createCharge(db, {
      userId: user.id,
      bookingId: booking.id,
      purpose: 'booking_deposit',
      amountCents: 4851,
    });
    const [refund] = await db
      .insert(refunds)
      .values({
        chargeId: charge.id,
        bookingId: booking.id,
        provider: 'sandbox',
        amountCents: 4851,
        reason: 'manual',
        status: 'pending',
        attempts: 2,
      })
      .returning();

    const stats = await run(null);

    expect(stats).toMatchObject({ refundsProcessed: 1, refundsApproved: 1 });
    const [after] = await db
      .select()
      .from(refunds)
      .where(eq(refunds.id, refund?.id ?? ''));
    expect(after?.status).toBe('approved');
    expect(after?.completedAt).not.toBeNull();
    expect((await db.select().from(charges).where(eq(charges.id, charge.id)))[0]?.status).toBe(
      'refunded',
    );
  });
});
