import {
  localToUtc,
  occurrenceCheckSchema,
  packageOfferListSchema,
  subscriptionQuoteSchema,
} from '@bravo/core';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTenant, seededRoom } from '../../../test/booking-helpers';
import {
  createCoupon,
  createCreditLot,
  createFixedCategory,
  createHourPackageCategory,
} from '../../../test/factories/revenue';
import { forbiddenFetch, send, testEnv } from '../../../test/http';
import { requireTestDatabaseUrl } from '../../../test/require-test-db';
import { createApp } from '../../app';
import { createDb } from '../../db/client';
import { bookingCategories, blocks, roomOccupancy } from '../../db/schema';
import { runSeed } from '../../db/seed';
import { AppError } from '../../lib/errors';
import { quoteSubscription } from '../../modules/subscriptions/quote.service';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

// Monday 2026-10-26 09:00 BRT.
const NOW = new Date('2026-10-26T12:00:00.000Z');
const app = () => createApp({ db, now: () => NOW, fetch: forbiddenFetch, env: testEnv() });

beforeEach(async () => {
  await runSeed(db);
});

const seeded = async (name: string) => {
  const [row] = await db.select().from(bookingCategories).where(eq(bookingCategories.name, name));
  if (row === undefined) throw new Error(`no seeded category ${name}`);
  return row;
};

async function errorOf(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('expected an AppError');
}

describe('GET /public/packages (REC-07, REC-08, REC-155)', () => {
  it('lists the active public package categories with average hour value and estimate', async () => {
    await createHourPackageCategory(db, { name: 'Pacote inativo', status: 'inactive' });
    await createHourPackageCategory(db, { name: 'Pacote da casa', visibility: 'admin_only' });
    const res = await send(app(), 'GET', '/public/packages');
    expect(res.status).toBe(200);
    const { items } = packageOfferListSchema.parse(res.body);
    expect(items.map((o) => o.name)).toEqual([
      'Meio turno mensal',
      'Turno mensal',
      'Pacote 20h mensal',
      'Pacote 30h mensal',
    ]);
    expect(items.find((o) => o.name === 'Pacote 20h mensal')).toMatchObject({
      type: 'hour_package',
      priceCents: 160_000,
      includedMinutes: 1200,
      avgHourCents: 8000,
      period: 'monthly',
      periodDays: 30,
    });
    expect(items.find((o) => o.name === 'Meio turno mensal')).toMatchObject({
      type: 'fixed_schedule',
      pricePerOccurrenceCents: 28_000,
      weekdays: [1, 2, 3, 4, 5],
      startMinute: 420,
      endMinute: 570,
      avgHourCents: 11_200,
      estimate: { minCount: 20, maxCount: 22, minCents: 560_000, maxCents: 616_000 },
    });
  });
});

describe('GET /public/packages/:categoryId/occurrences (REC-84, REC-89)', () => {
  const check = (categoryId: string, roomId: string, baseOn: string) =>
    send(
      app(),
      'GET',
      `/public/packages/${categoryId}/occurrences?roomId=${roomId}&baseOn=${baseOn}`,
    );

  it('returns 22 occurrences and R$ 6.160,00 for Meio turno from 2026-11-02 without conflicts', async () => {
    const category = await seeded('Meio turno mensal');
    const room = await seededRoom(db);
    const res = await check(category.id, room.id, '2026-11-02');
    expect(res.status).toBe(200);
    const body = occurrenceCheckSchema.parse(res.body);
    expect(body).toMatchObject({
      startsOn: '2026-11-02',
      endsOn: '2026-12-02',
      periodPriceCents: 616_000,
      conflicts: [],
      suggestions: { rooms: [], baseDates: [] },
    });
    expect(body.occurrences).toHaveLength(22);
    expect(body.occurrences[0]).toEqual({
      date: '2026-11-02',
      startsAt: '2026-11-02T10:00:00.000Z',
      endsAt: '2026-11-02T12:30:00.000Z',
    });
  });

  it('reports a blocked date and suggests the other rooms and conflict-free base dates', async () => {
    const category = await seeded('Meio turno mensal');
    const principal = await seededRoom(db, 'principal');
    const [block] = await db
      .insert(blocks)
      .values({
        roomId: principal.id,
        tag: 'Manutenção',
        startsAt: localToUtc('2026-11-10', 420),
        endsAt: localToUtc('2026-11-10', 480),
      })
      .returning();
    await db.insert(roomOccupancy).values({
      roomId: principal.id,
      period: `[${localToUtc('2026-11-10', 420).toISOString()},${localToUtc('2026-11-10', 480).toISOString()})`,
      kind: 'block',
      refId: block?.id ?? '',
    });
    const body = occurrenceCheckSchema.parse(
      (await check(category.id, principal.id, '2026-11-02')).body,
    );
    expect(body.conflicts).toEqual([
      { date: '2026-11-10', reason: 'overlaps_block', label: 'Bloqueado' },
    ]);
    expect(body.suggestions.rooms.map((r) => r.roomName)).toEqual([
      (await seededRoom(db, 'secundaria')).name,
      (await seededRoom(db, 'terceira')).name,
    ]);
    expect(body.suggestions.baseDates).toEqual(['2026-11-11', '2026-11-12', '2026-11-13']);
  });

  it('answers 404 for an inactive or hour-package category and 422 for a base date out of range', async () => {
    const room = await seededRoom(db);
    const inactive = await createFixedCategory(db, { status: 'inactive' });
    const hour = await seeded('Pacote 20h mensal');
    const fixed = await seeded('Meio turno mensal');
    expect((await check(inactive.id, room.id, '2026-11-02')).status).toBe(404);
    expect((await check(hour.id, room.id, '2026-11-02')).status).toBe(404);
    const late = await check(fixed.id, room.id, '2027-02-01');
    expect(late.status).toBe(422);
    expect(late.error?.details?.[0]).toEqual({
      path: 'baseOn',
      message: 'Escolha uma data base entre 26/10/2026 e 24/01/2027',
    });
  });
});

describe('quoteSubscription (REC-10, REC-11, REC-125)', () => {
  const quote = (userId: string, input: Record<string, unknown>, includeAdminOnly?: boolean) =>
    quoteSubscription(db, {
      userId,
      input: input as never,
      now: NOW,
      ...(includeAdminOnly !== undefined && { includeAdminOnly }),
    });

  it('Pacote 20h from 2026-11-02: the REC-10 values', async () => {
    const { user } = await createTenant(db);
    const category = await seeded('Pacote 20h mensal');
    const result = subscriptionQuoteSchema.parse(
      await quote(user.id, { categoryId: category.id, baseOn: '2026-11-02' }),
    );
    expect(result).toEqual({
      startsOn: '2026-11-02',
      endsOn: '2026-12-02',
      renewsOn: '2026-12-02',
      chargeDueOn: '2026-11-30',
      priceCents: 160_000,
      includedMinutes: 1200,
      vPacCents: 8000,
      discountCents: 0,
      creditAvailableCents: 0,
      creditAppliedCents: 0,
      payNowCents: 160_000,
    });
  });

  it('applies a package coupon and credits to the first payment', async () => {
    const { user } = await createTenant(db);
    await createCoupon(db, { code: 'PACOTE10', appliesTo: 'packages' });
    await createCreditLot(db, { userId: user.id, amountCents: 5000 });
    const category = await seeded('Pacote 20h mensal');
    const result = await quote(user.id, {
      categoryId: category.id,
      baseOn: '2026-11-02',
      couponCode: 'pacote10',
      useCredits: true,
    });
    expect(result).toMatchObject({
      discountCents: 16_000,
      creditAvailableCents: 5000,
      creditAppliedCents: 5000,
      payNowCents: 139_000,
    });
  });

  it('reports a booking-only coupon as not applicable and keeps the price', async () => {
    const { user } = await createTenant(db);
    await createCoupon(db, { code: 'SOHORA', appliesTo: 'bookings' });
    const category = await seeded('Pacote 20h mensal');
    const result = await quote(user.id, {
      categoryId: category.id,
      baseOn: '2026-11-02',
      couponCode: 'SOHORA',
    });
    expect(result.couponRejection).toEqual({
      reason: 'not_applicable',
      message: 'Cupom não se aplica a esta compra',
    });
    expect(result.payNowCents).toBe(160_000);
  });

  it('prices a fixed schedule per occurrence × count in the chosen room', async () => {
    const { user } = await createTenant(db);
    const category = await seeded('Meio turno mensal');
    const room = await seededRoom(db);
    const result = await quote(user.id, {
      categoryId: category.id,
      baseOn: '2026-11-02',
      roomId: room.id,
    });
    expect(result).toMatchObject({
      priceCents: 616_000,
      occurrenceCount: 22,
      conflicts: [],
      payNowCents: 616_000,
    });
  });

  it('rejects a base date before today with the REC-11 message on baseOn', async () => {
    const { user } = await createTenant(db);
    const category = await seeded('Pacote 20h mensal');
    const error = await errorOf(quote(user.id, { categoryId: category.id, baseOn: '2026-10-25' }));
    expect(error).toMatchObject({ status: 422, code: 'VALIDATION_FAILED' });
    expect(error.details).toEqual([
      { path: 'baseOn', message: 'Escolha uma data base entre 26/10/2026 e 24/01/2027' },
    ]);
  });

  it('answers 404 for an inactive category and for an admin-only one outside the admin sale', async () => {
    const { user } = await createTenant(db);
    const inactive = await createHourPackageCategory(db, { status: 'inactive' });
    const adminOnly = await createHourPackageCategory(db, { visibility: 'admin_only' });
    expect(
      await errorOf(quote(user.id, { categoryId: inactive.id, baseOn: '2026-11-02' })),
    ).toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });
    expect(
      await errorOf(quote(user.id, { categoryId: adminOnly.id, baseOn: '2026-11-02' })),
    ).toMatchObject({
      status: 404,
    });
    const sold = await quote(user.id, { categoryId: adminOnly.id, baseOn: '2026-11-02' }, true);
    expect(sold.priceCents).toBe(160_000);
  });
});
