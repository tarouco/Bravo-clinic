import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCharge, createTenant, seededRoom } from '../../test/booking-helpers';
import { createBooking as insertBooking } from '../../test/factories';
import { forbiddenFetch, testEnv } from '../../test/http';
import { requireTestDatabaseUrl } from '../../test/require-test-db';
import { createDb } from '../db/client';
import { bookings, charges, emailOutbox, paymentCustomers, savedCards } from '../db/schema';
import { runSeed } from '../db/seed';
import { createRegistry, type Registry } from '../extensions/registry';
import { chargeBalances } from './charge-balances';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

const HOUR = 3_600_000;
const NOW = new Date('2026-10-20T12:00:00.000Z');
const after = (hours: number) => new Date(NOW.getTime() + hours * HOUR);

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

/** W-SP shape: 16000 booking, 8000 sinal paid, starting `startsInHours` from NOW. */
async function depositPaidBooking(startsInHours: number) {
  const { user } = await createTenant(db, { now: NOW });
  const starts = after(startsInHours);
  const booking = await insertBooking(db, {
    userId: user.id,
    roomId,
    startsAt: starts,
    endsAt: new Date(starts.getTime() + 2 * HOUR),
    totalCents: 16000,
    depositCents: 8000,
    paidCents: 8000,
    balanceChargeAt: new Date(starts.getTime() - 48 * HOUR),
    balanceDueAt: new Date(starts.getTime() - 24 * HOUR),
  });
  return { user, booking, starts };
}

async function saveCard(userId: string, last4: string, consent: boolean) {
  await db
    .insert(paymentCustomers)
    .values({ userId, provider: 'sandbox', externalCustomerId: `sbx_cus_${userId}` })
    .onConflictDoNothing();
  const [card] = await db
    .insert(savedCards)
    .values({
      userId,
      provider: 'sandbox',
      externalCardId: `sbx_card_${last4}_${userId.slice(0, 8)}`,
      brand: 'visa',
      last4,
      expMonth: 12,
      expYear: 2030,
      recurringConsentAt: consent ? NOW : null,
    })
    .returning();
  return card;
}

const templates = async () => (await db.select().from(emailOutbox)).map((m) => m.template).sort();
const chargesOf = (bookingId: string) =>
  db.select().from(charges).where(eq(charges.bookingId, bookingId));

describe('charge-balances: charging (NUC-130, NUC-131)', () => {
  it('charges the saved card with consent: a booking_balance charge that settles the booking', async () => {
    const { user, booking } = await depositPaidBooking(48);
    await saveCard(user.id, '4242', true);

    const stats = await chargeBalances(depsAt(NOW), NOW);

    expect(stats).toMatchObject({ cardCharged: 1, pixCreated: 0, cancelledNonpayment: 0 });
    const [charge] = await chargesOf(booking.id);
    expect(charge).toMatchObject({
      purpose: 'booking_balance',
      method: 'saved_card',
      status: 'approved',
      amountCents: 8000,
    });
    const [stored] = await db.select().from(bookings).where(eq(bookings.id, booking.id));
    expect(stored).toMatchObject({ status: 'paid', paidCents: 16000, balanceCents: 0 });
    expect(await templates()).toEqual(['booking.balance_charged']);
  });

  it('creates a Pix charge expiring at start − 24 h and mails booking.balance_charge; a rerun adds nothing', async () => {
    const { user, booking, starts } = await depositPaidBooking(48);
    await saveCard(user.id, '4242', false);

    const first = await chargeBalances(depsAt(NOW), NOW);
    const second = await chargeBalances(depsAt(NOW), NOW);

    expect(first).toMatchObject({ pixCreated: 1, cardCharged: 0 });
    expect(second).toMatchObject({ pixCreated: 0, cardCharged: 0 });
    const rows = await chargesOf(booking.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      purpose: 'booking_balance',
      method: 'pix',
      status: 'pending',
      amountCents: 8000,
    });
    expect(rows[0]?.expiresAt?.toISOString()).toBe(
      new Date(starts.getTime() - 24 * HOUR).toISOString(),
    );
    expect(await templates()).toEqual(['booking.balance_charge']);
  });

  it('falls back to Pix and mails booking.balance_card_failed when the card is declined', async () => {
    const { user, booking } = await depositPaidBooking(48);
    await saveCard(user.id, '0002', true);

    const stats = await chargeBalances(depsAt(NOW), NOW);
    const again = await chargeBalances(depsAt(NOW), NOW);

    expect(stats).toMatchObject({ cardFailed: 1, pixCreated: 1 });
    expect(again).toMatchObject({ cardFailed: 0, pixCreated: 0 });
    const rows = await chargesOf(booking.id);
    expect(rows.map((r) => [r.method, r.status]).sort()).toEqual([
      ['pix', 'pending'],
      ['saved_card', 'rejected'],
    ]);
    expect(await templates()).toEqual(['booking.balance_card_failed']);
    expect((await db.select().from(bookings).where(eq(bookings.id, booking.id)))[0]?.status).toBe(
      'confirmed',
    );
  });

  it('does not charge before balance_charge_at nor a booking whose balance is already paid', async () => {
    const early = await depositPaidBooking(60);
    const settled = await depositPaidBooking(48);
    await db
      .update(bookings)
      .set({ status: 'paid', paidCents: 16000, balanceCents: 0 })
      .where(eq(bookings.id, settled.booking.id));

    const stats = await chargeBalances(depsAt(NOW), NOW);

    expect(stats).toMatchObject({ pixCreated: 0, cardCharged: 0 });
    expect(await chargesOf(early.booking.id)).toHaveLength(0);
    expect(await chargesOf(settled.booking.id)).toHaveLength(0);
  });
});

describe('charge-balances: deadline (NUC-132)', () => {
  it('cancels for non-payment at start − 24 h: sinal retained, slot freed, pending charge cancelled', async () => {
    const { user, booking } = await depositPaidBooking(24);
    const pending = await createCharge(db, {
      userId: user.id,
      bookingId: booking.id,
      purpose: 'booking_balance',
      amountCents: 8000,
      status: 'pending',
    });
    const notifyStaff = vi.fn(() => Promise.resolve());

    const stats = await chargeBalances(depsAt(NOW, { notifications: { notifyStaff } }), NOW);

    expect(stats).toMatchObject({ cancelledNonpayment: 1, pixCreated: 0 });
    const [stored] = await db.select().from(bookings).where(eq(bookings.id, booking.id));
    expect(stored).toMatchObject({
      status: 'cancelled_nonpayment',
      paidCents: 8000,
      icsSequence: 1,
    });
    const { rows: active } = await pool.query(
      `select 1 from room_occupancy where ref_id = $1 and active`,
      [booking.id],
    );
    expect(active).toHaveLength(0);
    expect((await db.select().from(charges).where(eq(charges.id, pending.id)))[0]?.status).toBe(
      'cancelled',
    );
    expect(await templates()).toEqual(['booking.cancelled_nonpayment']);
    expect(notifyStaff).toHaveBeenCalledWith(
      'booking_cancelled',
      expect.objectContaining({ entityId: booking.id }),
    );
  });

  it('leaves a booking alone one minute before its deadline', async () => {
    const { booking } = await depositPaidBooking(24);
    await db
      .update(bookings)
      .set({ balanceDueAt: new Date(NOW.getTime() + 60_000) })
      .where(eq(bookings.id, booking.id));

    const stats = await chargeBalances(depsAt(NOW), NOW);

    expect(stats).toMatchObject({ cancelledNonpayment: 0 });
    expect((await db.select().from(bookings).where(eq(bookings.id, booking.id)))[0]?.status).toBe(
      'confirmed',
    );
  });
});
