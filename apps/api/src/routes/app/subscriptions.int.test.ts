import { randomUUID } from 'node:crypto';
import {
  cancelPreviewSchema,
  cancelResultSchema,
  ledgerPageSchema,
  localToUtc,
  payResultSchema,
  subscriptionListSchema,
  subscriptionPurchaseResultSchema,
  subscriptionQuoteSchema,
  subscriptionSchema,
  switchQuoteSchema,
} from '@bravo/core';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTenant, seededRoom } from '../../../test/booking-helpers';
import { createBooking } from '../../../test/factories';
import { createHourPackageCategory, createSubscription } from '../../../test/factories/revenue';
import { forbiddenFetch, send, testEnv } from '../../../test/http';
import { requireTestDatabaseUrl } from '../../../test/require-test-db';
import { createApp } from '../../app';
import { createDb } from '../../db/client';
import {
  blocks,
  bookingCategories,
  packageLedger,
  roomOccupancy,
  subscriptions,
} from '../../db/schema';
import { runSeed } from '../../db/seed';
import { buildRegistry } from '../../extensions';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

// Monday 2026-10-26 09:00 BRT.
const NOW = new Date('2026-10-26T12:00:00.000Z');
const app = () =>
  createApp({
    db,
    env: testEnv(),
    fetch: forbiddenFetch,
    now: () => NOW,
    registry: buildRegistry(),
  });

beforeEach(async () => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  await runSeed(db);
});

const seeded = async (name: string) => {
  const [row] = await db.select().from(bookingCategories).where(eq(bookingCategories.name, name));
  if (row === undefined) throw new Error(`no seeded category ${name}`);
  return row;
};

const purchaseBody = (categoryId: string, extra: Record<string, unknown> = {}) => ({
  categoryId,
  baseOn: '2026-11-02',
  paymentMethod: 'pix',
  acceptTerms: true,
  acceptRecurring: true,
  ...extra,
});

/** A tenant with Pacote 20h active since 2026-10-12 (6 h left). */
async function subscriber() {
  const tenant = await createTenant(db, { now: NOW });
  const category = await seeded('Pacote 20h mensal');
  const { subscription, period } = await createSubscription(db, {
    userId: tenant.user.id,
    category,
    baseOn: '2026-10-12',
    period: { status: 'active', minutesBalance: 360 },
  });
  return { ...tenant, subscription, period, category };
}

describe('POST /app/subscriptions/quote and purchase (REC-10, REC-14, REC-20)', () => {
  it('quotes Pacote 20h from 2026-11-02 with the REC-10 values', async () => {
    const { cookie } = await createTenant(db, { now: NOW });
    const pkg = await seeded('Pacote 20h mensal');
    const res = await send(app(), 'POST', '/app/subscriptions/quote', {
      cookie,
      body: { categoryId: pkg.id, baseOn: '2026-11-02' },
    });
    expect(res.status).toBe(200);
    expect(subscriptionQuoteSchema.parse(res.body)).toMatchObject({
      startsOn: '2026-11-02',
      endsOn: '2026-12-02',
      renewsOn: '2026-12-02',
      chargeDueOn: '2026-11-30',
      priceCents: 160_000,
      includedMinutes: 1200,
      vPacCents: 8000,
      payNowCents: 160_000,
    });
  });

  it('purchase answers 201 with the subscription awaiting payment and the Pix intent', async () => {
    const { cookie } = await createTenant(db, { now: NOW });
    const pkg = await seeded('Pacote 20h mensal');
    const res = await send(app(), 'POST', '/app/subscriptions', {
      cookie,
      body: purchaseBody(pkg.id),
      headers: { 'Idempotency-Key': randomUUID() },
    });
    expect(res.status).toBe(201);
    const body = subscriptionPurchaseResultSchema.parse(res.body);
    expect(body.subscription).toMatchObject({
      status: 'awaiting_payment',
      type: 'hour_package',
      category: { id: pkg.id, name: 'Pacote 20h mensal' },
      baseOn: '2026-11-02',
      holdExpiresAt: '2026-10-26T12:15:00.000Z',
      currentPeriod: { seq: 1, status: 'awaiting_payment', priceCents: 160_000 },
      nextCharge: null,
    });
    expect(body.charge).toMatchObject({ method: 'pix', status: 'pending', amountCents: 160_000 });
    expect(body.charge?.pixCopyPaste).toEqual(expect.any(String));
  });

  it('a replay returns the stored 201; another body with the same key is 422 IDEMPOTENCY_MISMATCH', async () => {
    const { cookie } = await createTenant(db, { now: NOW });
    const pkg = await seeded('Pacote 20h mensal');
    const key = randomUUID();
    const first = await send(app(), 'POST', '/app/subscriptions', {
      cookie,
      body: purchaseBody(pkg.id),
      headers: { 'Idempotency-Key': key },
    });
    const replay = await send(app(), 'POST', '/app/subscriptions', {
      cookie,
      body: purchaseBody(pkg.id),
      headers: { 'Idempotency-Key': key },
    });
    expect(replay.status).toBe(201);
    expect(replay.headers.get('Idempotent-Replayed')).toBe('true');
    expect(replay.body).toEqual(first.body);
    const other = await send(app(), 'POST', '/app/subscriptions', {
      cookie,
      body: purchaseBody(pkg.id, { baseOn: '2026-11-03' }),
      headers: { 'Idempotency-Key': key },
    });
    expect(other.status).toBe(422);
    expect(other.error?.code).toBe('IDEMPOTENCY_MISMATCH');
  });

  it('a purchase without Idempotency-Key is refused and writes nothing', async () => {
    const { user, cookie } = await createTenant(db, { now: NOW });
    const pkg = await seeded('Pacote 20h mensal');
    const res = await send(app(), 'POST', '/app/subscriptions', {
      cookie,
      body: purchaseBody(pkg.id),
    });
    // SPEC_DEVIATION: tasks.md T25 says 422; nucleo's idempotency middleware answers 400 BAD_REQUEST
    // for a missing or malformed key on every money route (lib/idempotency.ts), kept for consistency.
    expect(res.status).toBe(400);
    expect(res.error?.code).toBe('BAD_REQUEST');
    expect(await db.select().from(subscriptions).where(eq(subscriptions.userId, user.id))).toEqual(
      [],
    );
  });

  it('missing consents answer 422 POLICY_VIOLATION (REC-13)', async () => {
    const { cookie } = await createTenant(db, { now: NOW });
    const pkg = await seeded('Pacote 20h mensal');
    const res = await send(app(), 'POST', '/app/subscriptions', {
      cookie,
      body: purchaseBody(pkg.id, { acceptRecurring: false }),
      headers: { 'Idempotency-Key': randomUUID() },
    });
    expect(res.status).toBe(422);
    expect(res.error?.code).toBe('POLICY_VIOLATION');
  });
});

describe('subscription reads (REC-41, REC-143)', () => {
  it('lists only the caller subscriptions with balance and next charge', async () => {
    const { cookie, subscription } = await subscriber();
    await subscriber();
    const res = await send(app(), 'GET', '/app/subscriptions', { cookie });
    expect(res.status).toBe(200);
    const { items } = subscriptionListSchema.parse(res.body);
    expect(items.map((s) => s.id)).toEqual([subscription.id]);
    expect(items[0]).toMatchObject({
      status: 'active',
      balance: { packageMinutes: 360, includedMinutes: 1200, extraMinutes: 0 },
      nextCharge: { on: '2026-11-09', amountCents: 160_000, method: 'pix' },
      currentPeriod: { startsOn: '2026-10-12', endsOn: '2026-11-11', minutesBalance: 360 },
      nextPeriod: null,
    });
  });

  it('detail parses the Subscription contract; another user id is 404', async () => {
    const { cookie, subscription } = await subscriber();
    const other = await subscriber();
    const own = await send(app(), 'GET', `/app/subscriptions/${subscription.id}`, { cookie });
    expect(own.status).toBe(200);
    expect(subscriptionSchema.parse(own.body).id).toBe(subscription.id);
    const foreign = await send(app(), 'GET', `/app/subscriptions/${other.subscription.id}`, {
      cookie,
    });
    expect(foreign.status).toBe(404);
  });

  it('extrato shows "60 min + 18 min de excedente = 78 min" for the Wednesday booking', async () => {
    const { user, cookie, subscription, period } = await subscriber();
    const room = await seededRoom(db);
    const booking = await createBooking(db, {
      userId: user.id,
      roomId: room.id,
      startsAt: localToUtc('2026-10-28', 1140),
      endsAt: localToUtc('2026-10-28', 1200),
      paymentMode: 'package',
      totalCents: 0,
    });
    await db.insert(packageLedger).values({
      subscriptionId: subscription.id,
      periodId: period?.id ?? '',
      userId: user.id,
      entryType: 'debit',
      minutes: -78,
      bookingId: booking.id,
      detail: {
        durationMinutes: 60,
        debitMinutes: 78,
        vRefCentsPerHour: 9700,
        vPacCentsPerHour: 8000,
      },
    });
    const res = await send(app(), 'GET', `/app/subscriptions/${subscription.id}/ledger`, {
      cookie,
    });
    expect(res.status).toBe(200);
    const page = ledgerPageSchema.parse(res.body);
    expect(page.items[0]).toMatchObject({
      kind: 'package',
      entryType: 'debit',
      label: 'Reserva',
      minutes: -78,
      balanceAfter: 282,
      bookingCode: booking.code,
      detailText: '60 min + 18 min de excedente = 78 min',
    });
    expect(page.items[1]).toMatchObject({
      entryType: 'period_grant',
      label: 'Compra',
      minutes: 360,
    });
    expect(page.nextCursor).toBeNull();
  });

  it('cancel preview parses the contract; another user id is 404', async () => {
    const { cookie, subscription } = await subscriber();
    const other = await subscriber();
    const res = await send(app(), 'GET', `/app/subscriptions/${subscription.id}/cancel-preview`, {
      cookie,
    });
    expect(cancelPreviewSchema.parse(res.body)).toEqual({ minutesLost: 360, extraMinutesKept: 0 });
    const foreign = await send(
      app(),
      'GET',
      `/app/subscriptions/${other.subscription.id}/cancel-preview`,
      { cookie },
    );
    expect(foreign.status).toBe(404);
  });
});

describe('switch, cancel and pay (REC-72, REC-79)', () => {
  it('switch quote and start parse their contracts', async () => {
    const { cookie, subscription } = await subscriber();
    const target = await createHourPackageCategory(db, {
      fixedPriceCents: 225_000,
      includedMinutes: 1800,
    });
    const quote = await send(app(), 'POST', `/app/subscriptions/${subscription.id}/switch/quote`, {
      cookie,
      body: { categoryId: target.id },
    });
    expect(switchQuoteSchema.parse(quote.body)).toMatchObject({
      remainingMinutes: 360,
      convertedMinutes: 384,
      newPeriodTotalMinutes: 2184,
    });
    const started = await send(app(), 'POST', `/app/subscriptions/${subscription.id}/switch`, {
      cookie,
      body: { categoryId: target.id, paymentMethod: 'pix' },
      headers: { 'Idempotency-Key': randomUUID() },
    });
    expect(started.status).toBe(201);
    const body = subscriptionPurchaseResultSchema.parse(started.body);
    expect(body.subscription).toMatchObject({
      status: 'awaiting_payment',
      category: { id: target.id },
    });
    expect(body.charge?.amountCents).toBe(225_000);
  });

  it('cancel requires confirm and answers the cancelled subscription', async () => {
    const { cookie, subscription } = await subscriber();
    const refused = await send(app(), 'POST', `/app/subscriptions/${subscription.id}/cancel`, {
      cookie,
      body: {},
    });
    expect(refused.status).toBe(422);
    const res = await send(app(), 'POST', `/app/subscriptions/${subscription.id}/cancel`, {
      cookie,
      body: { confirm: true },
    });
    expect(res.status).toBe(200);
    expect(cancelResultSchema.parse(res.body).subscription.status).toBe('cancelled');
  });

  it('pay of an awaiting subscription answers the charge and the subscription; others get 404', async () => {
    const { cookie } = await createTenant(db, { now: NOW });
    const pkg = await seeded('Pacote 20h mensal');
    const bought = subscriptionPurchaseResultSchema.parse(
      (
        await send(app(), 'POST', '/app/subscriptions', {
          cookie,
          body: purchaseBody(pkg.id),
          headers: { 'Idempotency-Key': randomUUID() },
        })
      ).body,
    );
    const res = await send(app(), 'POST', `/app/subscriptions/${bought.subscription.id}/pay`, {
      cookie,
      body: { paymentMethod: 'pix' },
      headers: { 'Idempotency-Key': randomUUID() },
    });
    expect(res.status).toBe(200);
    const body = payResultSchema.parse(res.body);
    expect(body.charge).toMatchObject({ amountCents: 160_000, status: 'pending' });
    expect(body.charge?.chargeId).not.toBe(bought.charge?.chargeId);
    const stranger = await createTenant(db, { now: NOW });
    const foreign = await send(app(), 'POST', `/app/subscriptions/${bought.subscription.id}/pay`, {
      cookie: stranger.cookie,
      body: { paymentMethod: 'pix' },
      headers: { 'Idempotency-Key': randomUUID() },
    });
    expect(foreign.status).toBe(404);
  });
});

describe('documented errors', () => {
  it('another user subscription is 404 on ledger, switch quote, switch and cancel', async () => {
    const { cookie } = await subscriber();
    const other = await subscriber();
    const id = other.subscription.id;
    const target = await seeded('Pacote 30h mensal');
    const calls: [string, string, unknown, Record<string, string>?][] = [
      ['GET', `/app/subscriptions/${id}/ledger`, undefined],
      ['POST', `/app/subscriptions/${id}/switch/quote`, { categoryId: target.id }],
      [
        'POST',
        `/app/subscriptions/${id}/switch`,
        { categoryId: target.id, paymentMethod: 'pix' },
        { 'Idempotency-Key': randomUUID() },
      ],
      ['POST', `/app/subscriptions/${id}/cancel`, { confirm: true }],
    ];
    for (const [method, path, body, headers] of calls) {
      const res = await send(app(), method, path, {
        cookie,
        ...(body !== undefined && { body }),
        ...(headers !== undefined && { headers }),
      });
      expect(res.status).toBe(404);
    }
  });

  it('a fixed purchase over a blocked date answers 409 OCCURRENCE_CONFLICT with the dates', async () => {
    const { cookie } = await createTenant(db, { now: NOW });
    const meio = await seeded('Meio turno mensal');
    const room = await seededRoom(db);
    const [block] = await db
      .insert(blocks)
      .values({
        roomId: room.id,
        tag: 'Manutenção',
        startsAt: localToUtc('2026-11-10', 420),
        endsAt: localToUtc('2026-11-10', 480),
      })
      .returning();
    await db.insert(roomOccupancy).values({
      roomId: room.id,
      period: `[${localToUtc('2026-11-10', 420).toISOString()},${localToUtc('2026-11-10', 480).toISOString()})`,
      kind: 'block',
      refId: block?.id ?? '',
    });
    const res = await send(app(), 'POST', '/app/subscriptions', {
      cookie,
      body: purchaseBody(meio.id, { roomId: room.id }),
      headers: { 'Idempotency-Key': randomUUID() },
    });
    expect(res.status).toBe(409);
    expect(res.error?.code).toBe('OCCURRENCE_CONFLICT');
    expect(res.error?.details).toEqual([
      { path: 'date', message: 'Bloqueado', date: '2026-11-10', reason: 'overlaps_block' },
    ]);
  });
});

describe('auth and CSRF', () => {
  const id = randomUUID();
  const reads = [
    `/app/subscriptions`,
    `/app/subscriptions/${id}`,
    `/app/subscriptions/${id}/ledger`,
    `/app/subscriptions/${id}/cancel-preview`,
  ];
  const writes = [
    '/app/subscriptions/quote',
    '/app/subscriptions',
    `/app/subscriptions/${id}/switch/quote`,
    `/app/subscriptions/${id}/switch`,
    `/app/subscriptions/${id}/cancel`,
    `/app/subscriptions/${id}/pay`,
  ];

  it('every endpoint answers 401 without a session', async () => {
    for (const path of reads) expect((await send(app(), 'GET', path)).status).toBe(401);
    for (const path of writes) {
      expect((await send(app(), 'POST', path, { body: {} })).status).toBe(401);
    }
  });

  it('every mutation is rejected without a trusted Origin', async () => {
    const { cookie } = await createTenant(db, { now: NOW });
    for (const path of writes) {
      const response = await app().request(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: '{}',
      });
      expect(response.status).toBe(403);
      const body = (await response.json()) as { error: { code: string } };
      expect(body.error.code).toBe('CSRF_REJECTED');
    }
  });
});
