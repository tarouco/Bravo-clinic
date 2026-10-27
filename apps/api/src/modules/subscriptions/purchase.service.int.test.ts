import { randomUUID } from 'node:crypto';
import { localToUtc, type SubscriptionPurchaseInput } from '@bravo/core';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStaff, createTenant, seededRoom } from '../../../test/booking-helpers';
import { createCoupon, createCreditLot } from '../../../test/factories/revenue';
import { forbiddenFetch, testEnv } from '../../../test/http';
import { requireTestDatabaseUrl } from '../../../test/require-test-db';
import { createDb } from '../../db/client';
import {
  auditLog,
  blocks,
  bookingCategories,
  bookings,
  charges,
  consents,
  couponUses,
  emailOutbox,
  packageLedger,
  roomOccupancy,
  savedCards,
  subscriptionPeriods,
  subscriptions,
} from '../../db/schema';
import { runSeed } from '../../db/seed';
import { buildRegistry } from '../../extensions';
import type { RequestContext } from '../../lib/audit';
import { AppError } from '../../lib/errors';
import { purchaseSubscription, sellSubscription } from './purchase.service';

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
const META = { ip: '203.0.113.7', userAgent: 'vitest' };
const ctxOf = (userId: string, role = 'tenant'): RequestContext => ({
  actorUserId: userId,
  actorRole: role,
  origin: role === 'tenant' ? 'app' : 'admin',
  ip: null,
  requestId: null,
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

async function errorOf(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('expected an AppError');
}

const buy = (userId: string, body: Partial<SubscriptionPurchaseInput> & { categoryId: string }) =>
  purchaseSubscription(deps(), ctxOf(userId), META, {
    userId,
    source: 'app',
    body: {
      baseOn: '2026-11-02',
      paymentMethod: 'pix',
      acceptTerms: true,
      acceptRecurring: true,
      ...body,
    },
  });

const subscriptionsOf = (userId: string) =>
  db.select().from(subscriptions).where(eq(subscriptions.userId, userId));

async function savedCard(userId: string, overrides: Partial<typeof savedCards.$inferInsert> = {}) {
  const [card] = await db
    .insert(savedCards)
    .values({
      userId,
      provider: 'sandbox',
      externalCardId: `sbx_card_4242_${randomUUID()}`,
      last4: '4242',
      recurringConsentAt: NOW,
      ...overrides,
    })
    .returning();
  if (card === undefined) throw new Error('card insert returned no row');
  return card;
}

describe('purchaseSubscription: hour package (REC-12..REC-15, REC-21)', () => {
  it('creates the REC-14 rows and a pending subscription_initial charge', async () => {
    const pkg = await seeded('Pacote 20h mensal');
    const { user } = await createTenant(db, { now: NOW });
    const result = await buy(user.id, { categoryId: pkg.id });

    const [subscription] = await subscriptionsOf(user.id);
    expect(subscription).toMatchObject({
      id: result.subscriptionId,
      status: 'awaiting_payment',
      type: 'hour_package',
      baseOn: '2026-11-02',
      periodDays: 30,
      saleMode: 'self',
      source: 'app',
      paymentMethod: 'pix',
    });
    expect(subscription?.holdExpiresAt?.toISOString()).toBe('2026-10-26T12:15:00.000Z');
    const periods = await db
      .select()
      .from(subscriptionPeriods)
      .where(eq(subscriptionPeriods.subscriptionId, result.subscriptionId));
    expect(periods).toHaveLength(1);
    expect(periods[0]).toMatchObject({
      seq: 1,
      status: 'awaiting_payment',
      startsOn: '2026-11-02',
      endsOn: '2026-12-02',
      priceCents: 160_000,
      discountCents: 0,
      includedMinutes: 1200,
      minutesBalance: 0,
      priceSnapshot: { categoryVersion: 1, priceCents: 160_000, includedMinutes: 1200 },
    });
    const kinds = await db
      .select({ kind: consents.kind, refType: consents.refType, refId: consents.refId })
      .from(consents)
      .where(eq(consents.userId, user.id));
    expect(kinds.map((k) => k.kind).sort()).toEqual(['recurring_charge', 'subscription_terms']);
    expect(
      kinds.every((k) => k.refType === 'subscription' && k.refId === result.subscriptionId),
    ).toBe(true);
    expect(result.charge).toMatchObject({
      purpose: 'subscription_initial',
      status: 'pending',
      method: 'pix',
      amountCents: 160_000,
      subscriptionPeriodId: periods[0]?.id,
    });
    expect(result.charge?.pixCopyPaste).toEqual(expect.any(String));
  });

  it('refuses a second live hour package with 409 CONFLICT', async () => {
    const pkg = await seeded('Pacote 20h mensal');
    const other = await seeded('Pacote 30h mensal');
    const { user } = await createTenant(db, { now: NOW });
    await buy(user.id, { categoryId: pkg.id });
    const error = await errorOf(buy(user.id, { categoryId: other.id }));
    expect(error.status).toBe(409);
    expect(error.code).toBe('CONFLICT');
    expect(error.message).toBe('Você já tem um pacote de horas. Use “Trocar pacote” em Compras.');
    expect(await subscriptionsOf(user.id)).toHaveLength(1);
  });

  it('refuses a purchase without both consents with 422 POLICY_VIOLATION and writes nothing', async () => {
    const pkg = await seeded('Pacote 20h mensal');
    const { user } = await createTenant(db, { now: NOW });
    const error = await errorOf(
      buy(user.id, { categoryId: pkg.id, acceptRecurring: false } as never),
    );
    expect(error.status).toBe(422);
    expect(error.code).toBe('POLICY_VIOLATION');
    expect(await subscriptionsOf(user.id)).toHaveLength(0);
  });

  it('refuses a saved card of another user with 422 on savedCardId', async () => {
    const pkg = await seeded('Pacote 20h mensal');
    const { user } = await createTenant(db, { now: NOW });
    const { user: other } = await createTenant(db, { now: NOW });
    const card = await savedCard(other.id);
    const error = await errorOf(
      buy(user.id, { categoryId: pkg.id, paymentMethod: 'saved_card', savedCardId: card.id }),
    );
    expect(error.status).toBe(422);
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.details).toEqual([expect.objectContaining({ path: 'savedCardId' })]);
    expect(await subscriptionsOf(user.id)).toHaveLength(0);
  });

  it('refuses a card without recurring consent, deleted or from another gateway (REC-21)', async () => {
    const pkg = await seeded('Pacote 20h mensal');
    const { user } = await createTenant(db, { now: NOW });
    const cards = [
      await savedCard(user.id, { recurringConsentAt: null }),
      await savedCard(user.id, { deletedAt: NOW }),
      await savedCard(user.id, { provider: 'mercadopago', externalCardId: `mp_${randomUUID()}` }),
    ];
    for (const card of cards) {
      const error = await errorOf(
        buy(user.id, { categoryId: pkg.id, paymentMethod: 'saved_card', savedCardId: card.id }),
      );
      expect(error.status).toBe(422);
      expect(error.details).toEqual([expect.objectContaining({ path: 'savedCardId' })]);
    }
  });

  it('activates at once without a gateway charge when coupon and credits cover the price (REC-15)', async () => {
    const pkg = await seeded('Pacote 20h mensal');
    const { user } = await createTenant(db, { now: NOW });
    const coupon = await createCoupon(db, {
      code: 'PACOTE60',
      discountKind: 'fixed',
      discountValue: 60_000,
      appliesTo: 'packages',
    });
    await createCreditLot(db, { userId: user.id, amountCents: 100_000 });
    const result = await buy(user.id, {
      categoryId: pkg.id,
      baseOn: '2026-10-26',
      couponCode: 'pacote60',
      useCredits: true,
    });

    expect(result.charge).toBeNull();
    const [subscription] = await subscriptionsOf(user.id);
    expect(subscription?.status).toBe('active');
    expect(subscription?.holdExpiresAt).toBeNull();
    const [period] = await db
      .select()
      .from(subscriptionPeriods)
      .where(eq(subscriptionPeriods.subscriptionId, result.subscriptionId));
    expect(period).toMatchObject({ status: 'active', discountCents: 60_000, minutesBalance: 1200 });
    const grants = await db
      .select()
      .from(packageLedger)
      .where(eq(packageLedger.subscriptionId, result.subscriptionId));
    expect(grants.map((g) => [g.entryType, g.minutes])).toEqual([['period_grant', 1200]]);
    const money = await db.select().from(charges).where(eq(charges.userId, user.id));
    expect(money.map((c) => [c.provider, c.method, c.amountCents, c.status])).toEqual([
      ['internal', 'credit', 100_000, 'approved'],
    ]);
    const [use] = await db.select().from(couponUses).where(eq(couponUses.couponId, coupon.id));
    expect(use).toMatchObject({ status: 'consumed', subscriptionId: result.subscriptionId });
    const mails = await db
      .select({ template: emailOutbox.template })
      .from(emailOutbox)
      .where(eq(emailOutbox.dedupeKey, `subscription.activated:${result.subscriptionId}`));
    expect(mails).toEqual([{ template: 'subscription.activated' }]);
  });

  it('keeps the first period paid (not active) when the free activation is for a future base date', async () => {
    const pkg = await seeded('Pacote 20h mensal');
    const { user } = await createTenant(db, { now: NOW });
    await createCreditLot(db, { userId: user.id, amountCents: 160_000 });
    const result = await buy(user.id, { categoryId: pkg.id, useCredits: true });
    expect(result.charge).toBeNull();
    const [period] = await db
      .select()
      .from(subscriptionPeriods)
      .where(eq(subscriptionPeriods.subscriptionId, result.subscriptionId));
    expect(period).toMatchObject({ status: 'paid', minutesBalance: 0 });
    expect(period?.paidAt?.toISOString()).toBe(NOW.toISOString());
  });

  it('reserves a partial coupon and charges price − discount − credits', async () => {
    const pkg = await seeded('Pacote 20h mensal');
    const { user } = await createTenant(db, { now: NOW });
    const coupon = await createCoupon(db, { code: 'DEZPACOTE', appliesTo: 'packages' });
    await createCreditLot(db, { userId: user.id, amountCents: 5000 });
    const result = await buy(user.id, {
      categoryId: pkg.id,
      couponCode: 'DEZPACOTE',
      useCredits: true,
    });
    expect(result.charge?.amountCents).toBe(160_000 - 16_000 - 5000);
    const [use] = await db.select().from(couponUses).where(eq(couponUses.couponId, coupon.id));
    expect(use).toMatchObject({ status: 'reserved', discountCents: 16_000 });
    const [period] = await db
      .select()
      .from(subscriptionPeriods)
      .where(eq(subscriptionPeriods.subscriptionId, result.subscriptionId));
    expect(period?.discountCents).toBe(16_000);
  });

  it('rejects an invalid coupon with 422 COUPON_INVALID and creates nothing', async () => {
    const pkg = await seeded('Pacote 20h mensal');
    const { user } = await createTenant(db, { now: NOW });
    const error = await errorOf(buy(user.id, { categoryId: pkg.id, couponCode: 'NAOEXISTE' }));
    expect(error.status).toBe(422);
    expect(error.code).toBe('COUPON_INVALID');
    expect(error.details).toEqual([
      expect.objectContaining({ path: 'couponCode', reason: 'not_found' }),
    ]);
    expect(await subscriptionsOf(user.id)).toHaveLength(0);
  });

  it('answers 404 for an inactive or admin-only category (REC-07, REC-08)', async () => {
    const pkg = await seeded('Pacote 20h mensal');
    const { user } = await createTenant(db, { now: NOW });
    await db
      .update(bookingCategories)
      .set({ visibility: 'admin_only' })
      .where(eq(bookingCategories.id, pkg.id));
    expect((await errorOf(buy(user.id, { categoryId: pkg.id }))).status).toBe(404);
    await db
      .update(bookingCategories)
      .set({ visibility: 'public', status: 'inactive' })
      .where(eq(bookingCategories.id, pkg.id));
    expect((await errorOf(buy(user.id, { categoryId: pkg.id }))).status).toBe(404);
  });
});

describe('purchaseSubscription: fixed schedule (REC-85..REC-87)', () => {
  it('holds the 22 Meio turno occurrences as awaiting_payment with occupancy', async () => {
    const meio = await seeded('Meio turno mensal');
    const room = await seededRoom(db);
    const { user } = await createTenant(db, { now: NOW });
    const result = await buy(user.id, { categoryId: meio.id, roomId: room.id });

    const occurrences = await db
      .select()
      .from(bookings)
      .where(eq(bookings.subscriptionId, result.subscriptionId));
    expect(occurrences).toHaveLength(22);
    for (const o of occurrences) {
      expect(o).toMatchObject({
        kind: 'fixed_occurrence',
        paymentMode: 'subscription',
        status: 'awaiting_payment',
        roomId: room.id,
        totalCents: 0,
      });
      expect(o.holdExpiresAt?.toISOString()).toBe('2026-10-26T12:15:00.000Z');
    }
    const first = occurrences.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0];
    expect(first?.startsAt.toISOString()).toBe('2026-11-02T10:00:00.000Z');
    const occupancy = await db
      .select()
      .from(roomOccupancy)
      .where(and(eq(roomOccupancy.kind, 'booking'), eq(roomOccupancy.active, true)));
    expect(occupancy.filter((o) => occurrences.some((b) => b.id === o.refId))).toHaveLength(22);
    expect(result.charge?.amountCents).toBe(616_000);
    const [period] = await db
      .select()
      .from(subscriptionPeriods)
      .where(eq(subscriptionPeriods.subscriptionId, result.subscriptionId));
    expect(period).toMatchObject({ occurrenceCount: 22, priceCents: 616_000 });
  });

  it('answers 409 OCCURRENCE_CONFLICT listing the blocked date and creates nothing', async () => {
    const meio = await seeded('Meio turno mensal');
    const room = await seededRoom(db);
    const { user } = await createTenant(db, { now: NOW });
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
    const error = await errorOf(buy(user.id, { categoryId: meio.id, roomId: room.id }));
    expect(error.status).toBe(409);
    expect(error.code).toBe('OCCURRENCE_CONFLICT');
    expect(error.details).toEqual([
      { path: 'date', message: 'Bloqueado', date: '2026-11-10', reason: 'overlaps_block' },
    ]);
    expect(await subscriptionsOf(user.id)).toHaveLength(0);
    expect(await db.select().from(bookings).where(eq(bookings.userId, user.id))).toHaveLength(0);
  });

  it('aborts the whole purchase with 409 naming the date taken after the check (REC-87)', async () => {
    const meio = await seeded('Meio turno mensal');
    const room = await seededRoom(db);
    const { user } = await createTenant(db, { now: NOW });
    // An occupancy the availability read cannot see: only the exclusion constraint stops it.
    await db.insert(roomOccupancy).values({
      roomId: room.id,
      period: `[${localToUtc('2026-11-17', 420).toISOString()},${localToUtc('2026-11-17', 450).toISOString()})`,
      kind: 'block',
      refId: randomUUID(),
    });
    const error = await errorOf(buy(user.id, { categoryId: meio.id, roomId: room.id }));
    expect(error.status).toBe(409);
    expect(error.code).toBe('OCCURRENCE_CONFLICT');
    expect(error.details).toEqual([expect.objectContaining({ path: 'date', date: '2026-11-17' })]);
    expect(await subscriptionsOf(user.id)).toHaveLength(0);
    expect(await db.select().from(bookings).where(eq(bookings.userId, user.id))).toHaveLength(0);
  });
});

describe('sellSubscription (REC-150..REC-152)', () => {
  it('link sale holds pre_reserved occurrences for 24 h and queues sale_link', async () => {
    const meio = await seeded('Meio turno mensal');
    const room = await seededRoom(db);
    const { user: admin } = await createStaff(db, 'admin');
    const { user } = await createTenant(db, { now: NOW });
    const result = await sellSubscription(deps(), ctxOf(admin.id, 'admin'), {
      userId: user.id,
      categoryId: meio.id,
      baseOn: '2026-11-02',
      roomId: room.id,
      payment: { mode: 'link' },
    });
    expect(result.charge).toBeNull();
    const [subscription] = await subscriptionsOf(user.id);
    expect(subscription).toMatchObject({
      status: 'awaiting_payment',
      saleMode: 'link',
      source: 'admin',
      createdBy: admin.id,
    });
    expect(subscription?.holdExpiresAt?.toISOString()).toBe('2026-10-27T12:00:00.000Z');
    const held = await db
      .select()
      .from(bookings)
      .where(eq(bookings.subscriptionId, result.subscriptionId));
    expect(held).toHaveLength(22);
    expect(new Set(held.map((b) => b.status))).toEqual(new Set(['pre_reserved']));
    expect(held[0]?.holdExpiresAt?.toISOString()).toBe('2026-10-27T12:00:00.000Z');
    const [mail] = await db
      .select()
      .from(emailOutbox)
      .where(eq(emailOutbox.dedupeKey, `sale_link:${result.subscriptionId}:1`));
    expect(mail?.template).toBe('subscription.sale_link');
    expect(mail?.textBody).toContain(
      `http://localhost:5173/app/compras/assinaturas/${result.subscriptionId}/pagar`,
    );
  });

  it('link sale of an admin-only hour package with a 48 h hold', async () => {
    const pkg = await seeded('Pacote 20h mensal');
    await db
      .update(bookingCategories)
      .set({ visibility: 'admin_only' })
      .where(eq(bookingCategories.id, pkg.id));
    const { user: admin } = await createStaff(db, 'admin');
    const { user } = await createTenant(db, { now: NOW });
    const result = await sellSubscription(deps(), ctxOf(admin.id, 'admin'), {
      userId: user.id,
      categoryId: pkg.id,
      baseOn: '2026-11-02',
      payment: { mode: 'link', holdHours: 48 },
    });
    const [subscription] = await subscriptionsOf(user.id);
    expect(subscription?.id).toBe(result.subscriptionId);
    expect(subscription?.holdExpiresAt?.toISOString()).toBe('2026-10-28T12:00:00.000Z');
  });

  it('manual sale is active without a charge and audits subscription.confirm_manual', async () => {
    const pkg = await seeded('Pacote 20h mensal');
    const { user: admin } = await createStaff(db, 'admin');
    const { user } = await createTenant(db, { now: NOW });
    const result = await sellSubscription(deps(), ctxOf(admin.id, 'admin'), {
      userId: user.id,
      categoryId: pkg.id,
      baseOn: '2026-10-26',
      payment: { mode: 'manual', justification: 'Pagamento em dinheiro na recepção' },
    });
    const [subscription] = await subscriptionsOf(user.id);
    expect(subscription).toMatchObject({ status: 'active', saleMode: 'manual' });
    expect(await db.select().from(charges).where(eq(charges.userId, user.id))).toHaveLength(0);
    const [entry] = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'subscription.confirm_manual'));
    expect(entry).toMatchObject({
      entityId: result.subscriptionId,
      actorUserId: admin.id,
      justification: 'Pagamento em dinheiro na recepção',
    });
    const [period] = await db
      .select()
      .from(subscriptionPeriods)
      .where(eq(subscriptionPeriods.subscriptionId, result.subscriptionId));
    expect(period).toMatchObject({ status: 'active', minutesBalance: 1200 });
  });
});
