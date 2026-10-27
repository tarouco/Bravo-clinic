import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { cpf, createTenant, seededRoom } from '../../../test/booking-helpers';
import { createBooking } from '../../../test/factories';
import { createCoupon, createCouponUse } from '../../../test/factories/revenue';
import { requireTestDatabaseUrl } from '../../../test/require-test-db';
import { createDb, withTransaction } from '../../db/client';
import { bookingEvents, couponUses, coupons, users } from '../../db/schema';
import { runSeed } from '../../db/seed';
import { AppError } from '../../lib/errors';
import { consumeUse, evaluateCoupon, releaseUse, reserveUse } from './coupons.service';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await runSeed(db);
});

const NOW = new Date('2026-11-01T12:00:00.000Z');

async function usesCount(couponId: string) {
  const [row] = await db.select().from(coupons).where(eq(coupons.id, couponId));
  return row?.usesCount;
}

const reserve = (couponId: string, userId: string) =>
  withTransaction(db, (tx) => reserveUse(tx, { couponId, userId, discountCents: 2000, now: NOW }));

describe('reserveUse (REC-123, REC-124)', () => {
  it('two checkouts racing for the last use: one reserves, the other gets COUPON_EXHAUSTED', async () => {
    const coupon = await createCoupon(db, {
      maxUses: 1,
      discountKind: 'fixed',
      discountValue: 2000,
    });
    const a = await createTenant(db);
    const b = await createTenant(db);
    const results = await Promise.allSettled([
      reserve(coupon.id, a.user.id),
      reserve(coupon.id, b.user.id),
    ]);
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const error = (rejected[0] as PromiseRejectedResult).reason as AppError;
    expect(error).toMatchObject({
      status: 409,
      code: 'COUPON_EXHAUSTED',
      message: 'Cupom esgotado',
    });
    expect(await usesCount(coupon.id)).toBe(1);
    const uses = await db.select().from(couponUses).where(eq(couponUses.couponId, coupon.id));
    expect(uses.map((u) => u.status)).toEqual(['reserved']);
  });

  it('stores the customer document on the reserved use', async () => {
    const coupon = await createCoupon(db);
    const { user } = await createTenant(db);
    const use = await reserve(coupon.id, user.id);
    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(use).toMatchObject({
      status: 'reserved',
      docNumber: row?.docNumber,
      discountCents: 2000,
    });
  });
});

describe('consumeUse and releaseUse (REC-124)', () => {
  it('release decrements uses_count; consume keeps it; a consumed use cannot be released', async () => {
    const coupon = await createCoupon(db, { maxUses: 10 });
    const { user } = await createTenant(db);
    const first = await reserve(coupon.id, user.id);
    const second = await reserve(coupon.id, user.id);
    expect(await usesCount(coupon.id)).toBe(2);

    const released = await withTransaction(db, (tx) => releaseUse(tx, { useId: first.id }, NOW));
    expect(released.map((u) => u.id)).toEqual([first.id]);
    expect(await usesCount(coupon.id)).toBe(1);

    const consumed = await withTransaction(db, (tx) => consumeUse(tx, { useId: second.id }, NOW));
    expect(consumed.map((u) => u.status)).toEqual(['consumed']);
    expect(await usesCount(coupon.id)).toBe(1);

    const again = await withTransaction(db, (tx) => releaseUse(tx, { useId: second.id }, NOW));
    expect(again).toEqual([]);
    expect(await usesCount(coupon.id)).toBe(1);
    const [row] = await db.select().from(couponUses).where(eq(couponUses.id, second.id));
    expect(row?.status).toBe('consumed');
  });
});

describe('evaluateCoupon', () => {
  const evaluate = (code: string, userId: string, target: 'booking' | 'package' = 'booking') =>
    evaluateCoupon(db, { code, userId, target, grossCents: 21_900, now: NOW });

  it('matches the code case-insensitively and prices 10% of 21900 as 2190 (REC-116, REC-127)', async () => {
    await createCoupon(db, { code: 'BRAVO10', discountKind: 'percent', discountValue: 1000 });
    const { user } = await createTenant(db);
    const result = await evaluate('bravo10', user.id);
    expect(result).toMatchObject({ ok: true, discountCents: 2190 });
  });

  it('answers not_found with "Cupom inexistente" for an unknown code', async () => {
    const { user } = await createTenant(db);
    expect(await evaluate('NADA', user.id)).toMatchObject({
      ok: false,
      reason: 'not_found',
      message: 'Cupom inexistente',
    });
  });

  it('refuses a disabled coupon at once (REC-126)', async () => {
    await createCoupon(db, { code: 'OFF10', enabled: false });
    const { user } = await createTenant(db);
    expect(await evaluate('OFF10', user.id)).toMatchObject({
      ok: false,
      reason: 'disabled',
      message: 'Cupom desabilitado',
    });
  });

  it('rejects a first-booking coupon for a customer with a confirmed booking (REC-118)', async () => {
    await createCoupon(db, { code: 'PRIMEIRA', type: 'first_booking', appliesTo: 'bookings' });
    const room = await seededRoom(db);
    const { user } = await createTenant(db);
    await createBooking(db, {
      userId: user.id,
      roomId: room.id,
      startsAt: new Date('2026-10-10T13:00:00Z'),
      endsAt: new Date('2026-10-10T14:00:00Z'),
      status: 'completed',
    });
    expect(await evaluate('PRIMEIRA', user.id)).toMatchObject({
      ok: false,
      reason: 'first_booking_only',
      message: 'Válido só na primeira reserva',
    });
  });

  it('counts a booking cancelled after confirmation, not one that only expired (REC-118)', async () => {
    await createCoupon(db, { code: 'PRIMEIRA', type: 'first_booking', appliesTo: 'bookings' });
    const room = await seededRoom(db);
    const fresh = await createTenant(db);
    await createBooking(db, {
      userId: fresh.user.id,
      roomId: room.id,
      startsAt: new Date('2026-10-10T13:00:00Z'),
      endsAt: new Date('2026-10-10T14:00:00Z'),
      status: 'expired',
      occupancy: false,
    });
    expect(await evaluate('PRIMEIRA', fresh.user.id)).toMatchObject({ ok: true });

    const cancelled = await createTenant(db);
    const booking = await createBooking(db, {
      userId: cancelled.user.id,
      roomId: room.id,
      startsAt: new Date('2026-10-11T13:00:00Z'),
      endsAt: new Date('2026-10-11T14:00:00Z'),
      status: 'cancelled_by_tenant',
      occupancy: false,
    });
    await db.insert(bookingEvents).values({
      bookingId: booking.id,
      fromStatus: 'awaiting_payment',
      toStatus: 'confirmed',
      origin: 'system',
    });
    expect(await evaluate('PRIMEIRA', cancelled.user.id)).toMatchObject({
      ok: false,
      reason: 'first_booking_only',
    });
  });

  it('rejects a first-booking coupon for a second account with the CPF of an earlier user (REC-118)', async () => {
    const coupon = await createCoupon(db, {
      code: 'PRIMEIRA',
      type: 'first_booking',
      appliesTo: 'bookings',
    });
    const document = cpf(9001);
    const first = await createTenant(db, { document: false });
    await createCouponUse(db, {
      couponId: coupon.id,
      userId: first.user.id,
      docNumber: document,
      status: 'consumed',
    });
    // The first account was anonymized; the CPF now belongs to a new account (users.doc_number is unique).
    const second = await createTenant(db, { document: false });
    await db
      .update(users)
      .set({ docType: 'cpf', docNumber: document })
      .where(eq(users.id, second.user.id));
    expect(await evaluate('PRIMEIRA', second.user.id)).toMatchObject({
      ok: false,
      reason: 'first_booking_only',
    });
  });

  it('applies the per-customer limit to reserved + consumed uses by document (REC-119)', async () => {
    const coupon = await createCoupon(db, { code: 'DUAS', perCustomerLimit: 2 });
    const { user } = await createTenant(db);
    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    await createCouponUse(db, {
      couponId: coupon.id,
      userId: user.id,
      docNumber: row?.docNumber ?? null,
      status: 'consumed',
    });
    await createCouponUse(db, {
      couponId: coupon.id,
      userId: user.id,
      docNumber: row?.docNumber ?? null,
      status: 'released',
    });
    expect(await evaluate('DUAS', user.id)).toMatchObject({ ok: true });
    await createCouponUse(db, {
      couponId: coupon.id,
      userId: user.id,
      docNumber: row?.docNumber ?? null,
      status: 'reserved',
    });
    expect(await evaluate('DUAS', user.id)).toMatchObject({
      ok: false,
      reason: 'customer_limit',
      message: 'Você já usou este cupom o número máximo de vezes',
    });
  });

  it('refuses a booking-only coupon on a package (not_applicable)', async () => {
    await createCoupon(db, { code: 'SOHORA', appliesTo: 'bookings' });
    const { user } = await createTenant(db);
    expect(await evaluate('SOHORA', user.id, 'package')).toMatchObject({
      ok: false,
      reason: 'not_applicable',
    });
  });
});
