import { randomUUID } from 'node:crypto';
import {
  creditsSummarySchema,
  extraHoursPurchaseResultSchema,
  extraHoursSummarySchema,
  purchaseHistoryPageSchema,
} from '@bravo/core';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCharge, createTenant } from '../../../test/booking-helpers';
import { createCreditLot, createSubscription } from '../../../test/factories/revenue';
import { forbiddenFetch, send, testEnv } from '../../../test/http';
import { requireTestDatabaseUrl } from '../../../test/require-test-db';
import { createApp } from '../../app';
import { createDb, withTransaction } from '../../db/client';
import {
  bookingCategories,
  charges,
  emailOutbox,
  extraHoursPurchases,
  extraMinuteLots,
  refunds,
} from '../../db/schema';
import { runSeed } from '../../db/seed';
import { buildRegistry } from '../../extensions';
import { newAfterCommit } from '../../modules/booking/effects';
import {
  expireExtraHoursPurchase,
  expiredExtraHoursPurchases,
} from '../../modules/extra-hours/extra-hours.service';
import {
  applyProviderStatus,
  SYSTEM_CONTEXT,
} from '../../modules/payments/payment-effects.service';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

// Monday 2026-10-26 09:00 BRT.
const NOW = new Date('2026-10-26T12:00:00.000Z');
const deps = () => ({
  db,
  env: testEnv(),
  fetch: forbiddenFetch,
  now: () => NOW,
  registry: buildRegistry(),
});
const app = () => createApp(deps());

beforeEach(async () => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  await runSeed(db);
});

const seeded = async (name: string) => {
  const [row] = await db.select().from(bookingCategories).where(eq(bookingCategories.name, name));
  if (row === undefined) throw new Error(`no seeded category ${name}`);
  return row;
};

async function subscriber() {
  const tenant = await createTenant(db, { now: NOW });
  const category = await seeded('Pacote 20h mensal');
  await createSubscription(db, {
    userId: tenant.user.id,
    category,
    baseOn: '2026-10-12',
    period: { status: 'active', minutesBalance: 600 },
  });
  return tenant;
}

const buy = (cookie: string, body: Record<string, unknown>) =>
  send(app(), 'POST', '/app/extra-hours', {
    cookie,
    body: { paymentMethod: 'pix', ...body },
    headers: { 'Idempotency-Key': randomUUID() },
  });

describe('GET /app/extra-hours (REC-62, REC-63, REC-65)', () => {
  it('Pacote 20h subscriber: eligible at 8000 per hour, 1..20 h', async () => {
    const { cookie } = await subscriber();
    const res = await send(app(), 'GET', '/app/extra-hours', { cookie });
    expect(res.status).toBe(200);
    expect(extraHoursSummarySchema.parse(res.body)).toEqual({
      eligible: true,
      unitPriceCents: 8000,
      minHours: 1,
      maxHours: 20,
      lots: [],
      totalRemainingMinutes: 0,
    });
  });

  it('non-subscriber: not eligible, and a purchase is refused with the REC-65 message', async () => {
    const { cookie } = await createTenant(db, { now: NOW });
    const res = await send(app(), 'GET', '/app/extra-hours', { cookie });
    expect(extraHoursSummarySchema.parse(res.body)).toMatchObject({
      eligible: false,
      reason: 'Horas extras são exclusivas para assinantes de um pacote de horas ativo.',
    });
    const post = await buy(cookie, { hours: 5 });
    expect(post.status).toBe(422);
    expect(post.error).toMatchObject({
      code: 'POLICY_VIOLATION',
      message: 'Horas extras são exclusivas para assinantes de um pacote de horas ativo.',
    });
  });

  it('requires a session (401)', async () => {
    const res = await send(app(), 'GET', '/app/extra-hours');
    expect(res.status).toBe(401);
  });
});

describe('POST /app/extra-hours (REC-63, REC-64, REC-66)', () => {
  it('5 h → a 40000 charge; approval creates a 300-min lot valid for 90 days', async () => {
    const { user, cookie } = await subscriber();
    const res = await buy(cookie, { hours: 5 });
    expect(res.status).toBe(201);
    const body = extraHoursPurchaseResultSchema.parse(res.body);
    expect(body.purchase).toMatchObject({
      hours: 5,
      unitPriceCents: 8000,
      totalCents: 40_000,
      status: 'awaiting_payment',
    });
    expect(body.charge).toMatchObject({ amountCents: 40_000, method: 'pix', status: 'pending' });

    const paidAt = new Date('2026-10-26T12:05:00.000Z');
    await applyProviderStatus(
      { ...deps(), now: () => paidAt },
      {
        provider: 'sandbox',
        chargeId: body.charge?.chargeId ?? '',
        status: 'approved',
        amountCents: 40_000,
      },
    );
    const [purchase] = await db
      .select()
      .from(extraHoursPurchases)
      .where(eq(extraHoursPurchases.id, body.purchase.id));
    expect(purchase).toMatchObject({ status: 'paid' });
    expect(purchase?.paidAt?.toISOString()).toBe(paidAt.toISOString());
    const [lot] = await db
      .select()
      .from(extraMinuteLots)
      .where(eq(extraMinuteLots.userId, user.id));
    expect(lot).toMatchObject({ source: 'purchase', minutesGranted: 300, minutesRemaining: 300 });
    expect(lot?.expiresAt.toISOString()).toBe('2027-01-24T12:05:00.000Z');
    const mails = await db
      .select()
      .from(emailOutbox)
      .where(eq(emailOutbox.template, 'extra_hours.purchased'));
    expect(mails).toHaveLength(1);
    const summary = extraHoursSummarySchema.parse(
      (await send(app(), 'GET', '/app/extra-hours', { cookie })).body,
    );
    expect(summary.totalRemainingMinutes).toBe(300);
  });

  it('21 h and 0 h are refused with 422 on hours', async () => {
    const { cookie } = await subscriber();
    for (const hours of [21, 0]) {
      const res = await buy(cookie, { hours });
      expect(res.status).toBe(422);
      expect(res.error?.code).toBe('VALIDATION_FAILED');
      expect(res.error?.details).toEqual([expect.objectContaining({ path: 'hours' })]);
    }
  });

  it('credits covering the total pay it at once without a charge', async () => {
    const { user, cookie } = await subscriber();
    await createCreditLot(db, { userId: user.id, amountCents: 50_000 });
    const res = await buy(cookie, { hours: 2, useCredits: true });
    expect(res.status).toBe(201);
    const body = extraHoursPurchaseResultSchema.parse(res.body);
    expect(body.charge).toBeNull();
    expect(body.purchase.status).toBe('paid');
    const [lot] = await db
      .select()
      .from(extraMinuteLots)
      .where(eq(extraMinuteLots.userId, user.id));
    expect(lot?.minutesGranted).toBe(120);
  });

  it('a late approval of a cancelled purchase is refunded in full', async () => {
    const { cookie } = await subscriber();
    const body = extraHoursPurchaseResultSchema.parse((await buy(cookie, { hours: 1 })).body);
    await db
      .update(extraHoursPurchases)
      .set({ status: 'cancelled' })
      .where(eq(extraHoursPurchases.id, body.purchase.id));
    await applyProviderStatus(deps(), {
      provider: 'sandbox',
      chargeId: body.charge?.chargeId ?? '',
      status: 'approved',
      amountCents: 8000,
    });
    const [refund] = await db
      .select()
      .from(refunds)
      .where(eq(refunds.chargeId, body.charge?.chargeId ?? ''));
    expect(refund).toMatchObject({ amountCents: 8000, reason: 'late_approval_conflict' });
  });
});

describe('expiry of an unpaid extra-hours hold (REC-70)', () => {
  it('cancels the purchase and its charge and returns the credits it used', async () => {
    const { user, cookie } = await subscriber();
    await createCreditLot(db, { userId: user.id, amountCents: 5000 });
    const body = extraHoursPurchaseResultSchema.parse(
      (await buy(cookie, { hours: 1, useCredits: true })).body,
    );
    expect(body.charge?.amountCents).toBe(3000);
    const later = new Date('2026-10-26T12:16:00.000Z');
    expect(await expiredExtraHoursPurchases(db, NOW)).toEqual([]);
    expect(await expiredExtraHoursPurchases(db, later)).toEqual([body.purchase.id]);
    const fx = newAfterCommit();
    const done = await withTransaction(db, (tx) =>
      expireExtraHoursPurchase(tx, SYSTEM_CONTEXT, body.purchase.id, later, fx),
    );
    expect(done).toBe(true);
    const [purchase] = await db
      .select()
      .from(extraHoursPurchases)
      .where(eq(extraHoursPurchases.id, body.purchase.id));
    expect(purchase?.status).toBe('cancelled');
    const [charge] = await db
      .select()
      .from(charges)
      .where(eq(charges.id, body.charge?.chargeId ?? ''));
    expect(charge?.status).toBe('cancelled');
    const credits = creditsSummarySchema.parse(
      (await send(app(), 'GET', '/app/credits', { cookie })).body,
    );
    expect(credits.availableCents).toBe(5000);
  });
});

describe('GET /app/credits and /app/purchases/history (REC-114, REC-145)', () => {
  it('credits: the contract, with the user own lots only', async () => {
    const { user, cookie } = await createTenant(db, { now: NOW });
    const { user: other } = await createTenant(db, { now: NOW });
    await createCreditLot(db, { userId: user.id, amountCents: 5000 });
    await createCreditLot(db, { userId: other.id, amountCents: 9000 });
    const res = await send(app(), 'GET', '/app/credits', { cookie });
    expect(res.status).toBe(200);
    const body = creditsSummarySchema.parse(res.body);
    expect(body.availableCents).toBe(5000);
    expect(body.lots.map((l) => l.amountCents)).toEqual([5000]);
  });

  it('history lists the user charges newest first and never another user', async () => {
    const { user, cookie } = await subscriber();
    const { user: other } = await createTenant(db, { now: NOW });
    await createCharge(db, {
      userId: user.id,
      bookingId: null,
      purpose: 'subscription_initial',
      amountCents: 160_000,
      createdAt: new Date('2026-10-01T12:00:00Z'),
    });
    await createCharge(db, {
      userId: other.id,
      bookingId: null,
      purpose: 'extra_hours',
      amountCents: 8000,
    });
    await buy(cookie, { hours: 5 });
    const res = await send(app(), 'GET', '/app/purchases/history', { cookie });
    expect(res.status).toBe(200);
    const page = purchaseHistoryPageSchema.parse(res.body);
    expect(page.items.map((i) => [i.purpose, i.amountCents, i.statusLabel])).toEqual([
      ['extra_hours', 40_000, 'Pendente'],
      ['subscription_initial', 160_000, 'Aprovado'],
    ]);
    expect(page.items[0]?.description).toBe('Horas extras (5 h)');
    expect(page.nextCursor).toBeNull();
  });
});
