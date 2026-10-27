import { randomUUID } from 'node:crypto';
import {
  adminSubscriptionListSchema,
  cancelResultSchema,
  ledgerPageSchema,
  periodSchema,
  subscriptionPurchaseResultSchema,
  subscriptionQuoteSchema,
  subscriptionSchema,
} from '@bravo/core';
import { eq, like } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStaff, createTenant, seededRoom } from '../../../test/booking-helpers';
import {
  createCoupon,
  createCouponUse,
  createCreditLot,
  createExtraLot,
  createSubscription,
} from '../../../test/factories/revenue';
import { forbiddenFetch, send, testEnv } from '../../../test/http';
import { requireTestDatabaseUrl } from '../../../test/require-test-db';
import { createApp } from '../../app';
import { createDb } from '../../db/client';
import { auditLog, bookingCategories, couponUses, emailOutbox, users } from '../../db/schema';
import { runSeed } from '../../db/seed';
import { buildRegistry } from '../../extensions';
import {
  getCustomerBalances,
  listCouponUsesByUser,
} from '../../modules/subscriptions/admin-queries.service';

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

async function customer(name: string, categoryName = 'Pacote 20h mensal', status = 'active') {
  const { user } = await createTenant(db, { now: NOW });
  await db.update(users).set({ name }).where(eq(users.id, user.id));
  const category = await seeded(categoryName);
  const room = category.type === 'fixed_schedule' ? await seededRoom(db) : null;
  const { subscription, period } = await createSubscription(db, {
    userId: user.id,
    category,
    status,
    roomId: room?.id ?? null,
    baseOn: '2026-10-12',
    period: { status: 'active', minutesBalance: 360 },
  });
  return { user, subscription, period };
}

describe('GET /admin/subscriptions (REC-148)', () => {
  it('filters by status and type, searches by name, and reception may read', async () => {
    const ana = await customer('Ana Souza');
    await customer('Bruno Lima', 'Meio turno mensal');
    await customer('Carla Dias', 'Pacote 20h mensal', 'suspended');
    const { cookie } = await createStaff(db, 'reception', NOW);

    const all = adminSubscriptionListSchema.parse(
      (await send(app(), 'GET', '/admin/subscriptions', { cookie })).body,
    );
    expect(all.items).toHaveLength(3);
    const active = adminSubscriptionListSchema.parse(
      (await send(app(), 'GET', '/admin/subscriptions?status=active&type=hour_package', { cookie }))
        .body,
    );
    expect(active.items.map((r) => r.customer.name)).toEqual(['Ana Souza']);
    expect(active.items[0]).toMatchObject({
      id: ana.subscription.id,
      statusLabel: 'Ativa',
      balanceText: '6h de 20h',
      nextChargeOn: '2026-11-09',
    });
    const search = adminSubscriptionListSchema.parse(
      (await send(app(), 'GET', '/admin/subscriptions?search=carla', { cookie })).body,
    );
    expect(search.items.map((r) => [r.customer.name, r.statusLabel])).toEqual([
      ['Carla Dias', 'Suspensa'],
    ]);
  });

  it('detail and extrato for staff; unknown id 404', async () => {
    const { subscription } = await customer('Ana Souza');
    const { cookie } = await createStaff(db, 'reception', NOW);
    const detail = await send(app(), 'GET', `/admin/subscriptions/${subscription.id}`, { cookie });
    expect(subscriptionSchema.parse(detail.body).id).toBe(subscription.id);
    const ledger = await send(app(), 'GET', `/admin/subscriptions/${subscription.id}/ledger`, {
      cookie,
    });
    expect(ledgerPageSchema.parse(ledger.body).items[0]).toMatchObject({
      entryType: 'period_grant',
      label: 'Compra',
      minutes: 360,
    });
    const missing = await send(app(), 'GET', `/admin/subscriptions/${randomUUID()}`, { cookie });
    expect(missing.status).toBe(404);
  });
});

describe('admin mutations (REC-43..REC-45, REC-82, REC-150..REC-154)', () => {
  it('reception gets 403 on quote, sell, cancel, adjust and resend', async () => {
    const { user, subscription } = await customer('Ana Souza');
    const { cookie } = await createStaff(db, 'reception', NOW);
    const pkg = await seeded('Pacote 30h mensal');
    const sale = {
      userId: user.id,
      categoryId: pkg.id,
      baseOn: '2026-11-02',
      payment: { mode: 'link' },
    };
    const calls: [string, unknown][] = [
      ['/admin/subscriptions/quote', sale],
      ['/admin/subscriptions', sale],
      [`/admin/subscriptions/${subscription.id}/cancel`, { justification: 'Pedido do cliente' }],
      [
        `/admin/subscriptions/${subscription.id}/adjust-balance`,
        { minutes: 30, justification: 'Ajuste de teste' },
      ],
      [`/admin/subscriptions/${subscription.id}/resend-link`, {}],
    ];
    for (const [path, body] of calls) {
      const res = await send(app(), 'POST', path, {
        cookie,
        body,
        headers: { 'Idempotency-Key': randomUUID() },
      });
      expect(res.status).toBe(403);
    }
  });

  it('quotes and sells an admin-only package by link; the response parses the contracts', async () => {
    const { user } = await createTenant(db, { now: NOW });
    const pkg = await seeded('Pacote 30h mensal');
    await db
      .update(bookingCategories)
      .set({ visibility: 'admin_only' })
      .where(eq(bookingCategories.id, pkg.id));
    const { cookie } = await createStaff(db, 'admin', NOW);
    const sale = {
      userId: user.id,
      categoryId: pkg.id,
      baseOn: '2026-11-02',
      payment: { mode: 'link' },
    };
    const quote = await send(app(), 'POST', '/admin/subscriptions/quote', { cookie, body: sale });
    expect(subscriptionQuoteSchema.parse(quote.body)).toMatchObject({ priceCents: 240_000 });
    const sold = await send(app(), 'POST', '/admin/subscriptions', {
      cookie,
      body: sale,
      headers: { 'Idempotency-Key': randomUUID() },
    });
    expect(sold.status).toBe(201);
    const body = subscriptionPurchaseResultSchema.parse(sold.body);
    expect(body.charge).toBeNull();
    expect(body.subscription).toMatchObject({
      status: 'awaiting_payment',
      holdExpiresAt: '2026-10-27T12:00:00.000Z',
    });
  });

  it('cancel without justification is 422; with it the subscription is cancelled and audited', async () => {
    const { subscription } = await customer('Ana Souza');
    const { cookie, user: admin } = await createStaff(db, 'admin', NOW);
    const refused = await send(app(), 'POST', `/admin/subscriptions/${subscription.id}/cancel`, {
      cookie,
      body: {},
    });
    expect(refused.status).toBe(422);
    const res = await send(app(), 'POST', `/admin/subscriptions/${subscription.id}/cancel`, {
      cookie,
      body: { justification: 'Cliente pediu pelo WhatsApp' },
    });
    expect(res.status).toBe(200);
    expect(cancelResultSchema.parse(res.body).subscription.status).toBe('cancelled');
    const [entry] = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'subscription.cancel'));
    expect(entry).toMatchObject({
      entityId: subscription.id,
      actorUserId: admin.id,
      justification: 'Cliente pediu pelo WhatsApp',
    });
  });

  it('adjust +30 answers the period and audits; below zero is 422 INSUFFICIENT_BALANCE', async () => {
    const { subscription, period } = await customer('Ana Souza');
    const { cookie } = await createStaff(db, 'admin', NOW);
    const res = await send(
      app(),
      'POST',
      `/admin/subscriptions/${subscription.id}/adjust-balance`,
      { cookie, body: { minutes: 30, justification: 'Reserva cancelada pela clínica' } },
    );
    expect(res.status).toBe(200);
    const { period: adjusted } = res.body as { period: unknown };
    expect(periodSchema.parse(adjusted)).toMatchObject({ id: period?.id, minutesBalance: 390 });
    const [entry] = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'package_ledger.adjust'));
    expect(entry?.before).toEqual({ minutesBalance: 360 });
    const negative = await send(
      app(),
      'POST',
      `/admin/subscriptions/${subscription.id}/adjust-balance`,
      { cookie, body: { minutes: -500, justification: 'Correção de saldo' } },
    );
    expect(negative.status).toBe(422);
    expect(negative.error?.code).toBe('INSUFFICIENT_BALANCE');
  });

  it('resend-link queues a new sale_link row; a non-pending subscription is 409', async () => {
    const { user } = await createTenant(db, { now: NOW });
    const pkg = await seeded('Pacote 20h mensal');
    const { cookie } = await createStaff(db, 'admin', NOW);
    const sold = subscriptionPurchaseResultSchema.parse(
      (
        await send(app(), 'POST', '/admin/subscriptions', {
          cookie,
          body: {
            userId: user.id,
            categoryId: pkg.id,
            baseOn: '2026-11-02',
            payment: { mode: 'link' },
          },
          headers: { 'Idempotency-Key': randomUUID() },
        })
      ).body,
    );
    const res = await send(
      app(),
      'POST',
      `/admin/subscriptions/${sold.subscription.id}/resend-link`,
      { cookie, body: {} },
    );
    expect(res.status).toBe(200);
    const rows = await db
      .select({ key: emailOutbox.dedupeKey })
      .from(emailOutbox)
      .where(like(emailOutbox.dedupeKey, `sale_link:${sold.subscription.id}:%`));
    expect(rows.map((r) => r.key).sort()).toEqual([
      `sale_link:${sold.subscription.id}:1`,
      `sale_link:${sold.subscription.id}:2`,
    ]);
    const { subscription: active } = await customer('Ana Souza');
    const conflict = await send(app(), 'POST', `/admin/subscriptions/${active.id}/resend-link`, {
      cookie,
      body: {},
    });
    expect(conflict.status).toBe(409);
  });
});

describe('admin mutation errors and manual sale', () => {
  it('a manual sale answers 201 with an active subscription and no charge', async () => {
    const { user } = await createTenant(db, { now: NOW });
    const pkg = await seeded('Pacote 20h mensal');
    const { cookie } = await createStaff(db, 'admin', NOW);
    const res = await send(app(), 'POST', '/admin/subscriptions', {
      cookie,
      body: {
        userId: user.id,
        categoryId: pkg.id,
        baseOn: '2026-10-26',
        payment: { mode: 'manual', justification: 'Pago em dinheiro' },
      },
      headers: { 'Idempotency-Key': randomUUID() },
    });
    expect(res.status).toBe(201);
    const body = subscriptionPurchaseResultSchema.parse(res.body);
    expect(body.charge).toBeNull();
    expect(body.subscription).toMatchObject({
      status: 'active',
      balance: { packageMinutes: 1200, includedMinutes: 1200 },
    });
  });

  it('adjust without justification is 422; on a fixed schedule it is 409 INVALID_TRANSITION', async () => {
    const hour = await customer('Ana Souza');
    const fixed = await customer('Bruno Lima', 'Meio turno mensal');
    const { cookie } = await createStaff(db, 'admin', NOW);
    const missing = await send(
      app(),
      'POST',
      `/admin/subscriptions/${hour.subscription.id}/adjust-balance`,
      { cookie, body: { minutes: 30 } },
    );
    expect(missing.status).toBe(422);
    expect(missing.error?.code).toBe('VALIDATION_FAILED');
    const onFixed = await send(
      app(),
      'POST',
      `/admin/subscriptions/${fixed.subscription.id}/adjust-balance`,
      { cookie, body: { minutes: 30, justification: 'Ajuste de teste' } },
    );
    expect(onFixed.status).toBe(409);
    expect(onFixed.error?.code).toBe('INVALID_TRANSITION');
  });

  it('answers 401 without a session and 404 for an unknown subscription', async () => {
    expect((await send(app(), 'GET', '/admin/subscriptions')).status).toBe(401);
    const { cookie } = await createStaff(db, 'admin', NOW);
    const id = randomUUID();
    for (const [path, body] of [
      [`/admin/subscriptions/${id}/cancel`, { justification: 'Pedido do cliente' }],
      [`/admin/subscriptions/${id}/adjust-balance`, { minutes: 30, justification: 'Ajuste' }],
      [`/admin/subscriptions/${id}/resend-link`, {}],
    ] as const) {
      expect((await send(app(), 'POST', path, { cookie, body })).status).toBe(404);
    }
  });
});

describe('customer reads for gestao (R12)', () => {
  it('getCustomerBalances returns one user open-period minutes, extra lots and credit lots', async () => {
    const ana = await customer('Ana Souza');
    const other = await customer('Bruno Lima');
    await createExtraLot(db, { userId: ana.user.id, minutes: 300 });
    await createExtraLot(db, { userId: other.user.id, minutes: 120 });
    await createCreditLot(db, { userId: ana.user.id, amountCents: 5000 });
    const balances = await getCustomerBalances(db, ana.user.id, NOW);
    expect(balances.periods.map((p) => [p.periodId, p.minutesBalance, p.includedMinutes])).toEqual([
      [ana.period?.id, 360, 1200],
    ]);
    expect(balances.extraLots.map((l) => l.minutesRemaining)).toEqual([300]);
    expect(balances.creditLots.map((l) => l.remainingCents)).toEqual([5000]);
  });

  it('listCouponUsesByUser lists that user uses newest first', async () => {
    const ana = await customer('Ana Souza');
    const other = await customer('Bruno Lima');
    const coupon = await createCoupon(db, { code: 'PRIMEIRO' });
    const [older] = await db
      .insert(couponUses)
      .values({
        couponId: coupon.id,
        userId: ana.user.id,
        status: 'consumed',
        discountCents: 0,
        createdAt: new Date('2026-10-01T12:00:00Z'),
      })
      .returning();
    const newer = await createCouponUse(db, {
      couponId: coupon.id,
      userId: ana.user.id,
      subscriptionId: ana.subscription.id,
    });
    await createCouponUse(db, { couponId: coupon.id, userId: other.user.id });
    const uses = await listCouponUsesByUser(db, ana.user.id);
    expect(uses.map((u) => [u.id, u.status, u.couponCode])).toEqual([
      [newer.id, 'reserved', 'PRIMEIRO'],
      [older?.id, 'consumed', 'PRIMEIRO'],
    ]);
    expect(uses[0]?.subscriptionCategory).toBe('Pacote 20h mensal');
  });
});
