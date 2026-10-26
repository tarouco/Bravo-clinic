import { couponListSchema, couponSchema, couponUseListSchema } from '@bravo/core';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createStaff, createTenant, seededRoom } from '../../../test/booking-helpers';
import { createBooking } from '../../../test/factories';
import {
  createCoupon,
  createCouponUse,
  createHourPackageCategory,
  createSubscription,
} from '../../../test/factories/revenue';
import { forbiddenFetch, send, testEnv } from '../../../test/http';
import { requireTestDatabaseUrl } from '../../../test/require-test-db';
import { createApp } from '../../app';
import { createDb } from '../../db/client';
import { auditLog, coupons } from '../../db/schema';
import { runSeed } from '../../db/seed';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

const NOW = new Date('2026-11-01T12:00:00.000Z');
const app = () => createApp({ db, now: () => NOW, fetch: forbiddenFetch, env: testEnv() });
const call = (method: string, path: string, cookie: string, body?: unknown) =>
  send(app(), method, path, { cookie, ...(body !== undefined && { body }) });

const bravo10 = {
  code: 'bravo10',
  type: 'discount',
  discountKind: 'percent',
  discountValue: 1000,
  appliesTo: 'both',
  maxUses: 100,
};

const actions = async () => (await db.select().from(auditLog)).map((a) => a.action);

describe('POST /admin/coupons (REC-129, REC-130)', () => {
  it('creates the coupon with the code upper-cased and audits coupon.create', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const res = await call('POST', '/admin/coupons', admin.cookie, bravo10);
    expect(res.status).toBe(201);
    const coupon = couponSchema.parse(res.body);
    expect(coupon).toMatchObject({
      code: 'BRAVO10',
      discountValue: 1000,
      maxUses: 100,
      usesCount: 0,
      enabled: true,
    });
    expect(await actions()).toContain('coupon.create');
  });

  it('answers 409 CONFLICT on the code field for a duplicate code', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    await call('POST', '/admin/coupons', admin.cookie, bravo10);
    const res = await call('POST', '/admin/coupons', admin.cookie, { ...bravo10, code: 'Bravo10' });
    expect(res.status).toBe(409);
    expect(res.error?.code).toBe('CONFLICT');
    expect(res.error?.details).toEqual([expect.objectContaining({ path: 'code' })]);
    expect(await db.select().from(coupons)).toHaveLength(1);
  });

  it('answers 422 for a malformed code and a percent above 100%', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const shortCode = await call('POST', '/admin/coupons', admin.cookie, {
      ...bravo10,
      code: 'AB',
    });
    const tooMuch = await call('POST', '/admin/coupons', admin.cookie, {
      ...bravo10,
      discountValue: 10_100,
    });
    expect(shortCode.status).toBe(422);
    expect(shortCode.error?.details?.[0]?.path).toBe('code');
    expect(tooMuch.status).toBe(422);
    expect(tooMuch.error?.details?.[0]?.path).toBe('discountValue');
  });
});

describe('PUT /admin/coupons/:id', () => {
  it('edits the coupon and audits coupon.update with before/after', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const coupon = await createCoupon(db, { code: 'BRAVO10', maxUses: 100 });
    const res = await call('PUT', `/admin/coupons/${coupon.id}`, admin.cookie, {
      ...bravo10,
      maxUses: 50,
    });
    expect(res.status).toBe(200);
    expect(couponSchema.parse(res.body).maxUses).toBe(50);
    const [row] = await db.select().from(auditLog).where(eq(auditLog.action, 'coupon.update'));
    expect(row?.before).toMatchObject({ maxUses: 100 });
    expect(row?.after).toMatchObject({ maxUses: 50 });
  });

  it('answers 422 on maxUses when it is below uses_count', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const coupon = await createCoupon(db, { code: 'BRAVO10', maxUses: 10, usesCount: 3 });
    const res = await call('PUT', `/admin/coupons/${coupon.id}`, admin.cookie, {
      ...bravo10,
      maxUses: 2,
    });
    expect(res.status).toBe(422);
    expect(res.error?.code).toBe('VALIDATION_FAILED');
    expect(res.error?.details?.[0]?.path).toBe('maxUses');
    const [row] = await db.select().from(coupons).where(eq(coupons.id, coupon.id));
    expect(row?.maxUses).toBe(10);
  });

  it('answers 404 for an unknown coupon', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const res = await call(
      'PUT',
      '/admin/coupons/00000000-0000-4000-8000-000000000000',
      admin.cookie,
      bravo10,
    );
    expect(res.status).toBe(404);
  });
});

describe('PATCH /admin/coupons/:id/enabled (REC-130)', () => {
  it('disables and re-enables with coupon.disable / coupon.enable audits', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const coupon = await createCoupon(db, { code: 'BRAVO10' });
    const off = await call('PATCH', `/admin/coupons/${coupon.id}/enabled`, admin.cookie, {
      enabled: false,
    });
    expect(couponSchema.parse(off.body).enabled).toBe(false);
    const on = await call('PATCH', `/admin/coupons/${coupon.id}/enabled`, admin.cookie, {
      enabled: true,
    });
    expect(couponSchema.parse(on.body).enabled).toBe(true);
    expect(await actions()).toEqual(['coupon.disable', 'coupon.enable']);
  });
});

describe('GET /admin/coupons and uses (REC-128, REC-131)', () => {
  it('lists coupons and a coupon history with customer, booking code, category and status', async () => {
    await runSeed(db);
    const admin = await createStaff(db, 'admin', NOW);
    const coupon = await createCoupon(db, { code: 'BRAVO10' });
    const room = await seededRoom(db);
    const { user } = await createTenant(db, { name: 'Ana Souza' });
    const booking = await createBooking(db, {
      userId: user.id,
      roomId: room.id,
      startsAt: new Date('2026-11-10T13:00:00Z'),
      endsAt: new Date('2026-11-10T14:00:00Z'),
    });
    const category = await createHourPackageCategory(db, { name: 'Pacote 20h mensal' });
    const { subscription } = await createSubscription(db, {
      userId: user.id,
      category,
      period: null,
    });
    await createCouponUse(db, {
      couponId: coupon.id,
      userId: user.id,
      bookingId: booking.id,
      status: 'consumed',
      discountCents: 2190,
    });
    await createCouponUse(db, {
      couponId: coupon.id,
      userId: user.id,
      subscriptionId: subscription.id,
      status: 'released',
      discountCents: 16000,
    });

    const list = couponListSchema.parse((await call('GET', '/admin/coupons', admin.cookie)).body);
    expect(list.items.map((c) => c.code)).toEqual(['BRAVO10']);
    const uses = couponUseListSchema.parse(
      (await call('GET', `/admin/coupons/${coupon.id}/uses`, admin.cookie)).body,
    );
    expect(uses.items).toHaveLength(2);
    expect(uses.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          customerName: 'Ana Souza',
          bookingCode: booking.code,
          discountCents: 2190,
          status: 'consumed',
        }),
        expect.objectContaining({
          subscriptionCategory: 'Pacote 20h mensal',
          discountCents: 16000,
          status: 'released',
        }),
      ]),
    );
  });
});

describe('reception (REC-132)', () => {
  it('gets 403 FORBIDDEN on every coupon route', async () => {
    const reception = await createStaff(db, 'reception', NOW);
    const coupon = await createCoupon(db, { code: 'BRAVO10' });
    const results = await Promise.all([
      call('GET', '/admin/coupons', reception.cookie),
      call('POST', '/admin/coupons', reception.cookie, bravo10),
      call('PUT', `/admin/coupons/${coupon.id}`, reception.cookie, bravo10),
      call('PATCH', `/admin/coupons/${coupon.id}/enabled`, reception.cookie, { enabled: false }),
      call('GET', `/admin/coupons/${coupon.id}/uses`, reception.cookie),
    ]);
    expect(results.map((r) => r.status)).toEqual([403, 403, 403, 403, 403]);
    expect(results.every((r) => r.error?.code === 'FORBIDDEN')).toBe(true);
  });
});
