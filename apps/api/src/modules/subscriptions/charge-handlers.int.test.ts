import { randomUUID } from 'node:crypto';
import { formatBRL, type SubscriptionPurchaseInput } from '@bravo/core';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTenant, seededRoom } from '../../../test/booking-helpers';
import { createCoupon, createSubscription } from '../../../test/factories/revenue';
import { forbiddenFetch, testEnv } from '../../../test/http';
import { requireTestDatabaseUrl } from '../../../test/require-test-db';
import { createDb, withTransaction } from '../../db/client';
import {
  bookingCategories,
  bookings,
  charges,
  couponUses,
  emailOutbox,
  packageLedger,
  paymentCustomers,
  refunds,
  savedCards,
  subscriptionPeriods,
  subscriptions,
} from '../../db/schema';
import { runSeed } from '../../db/seed';
import { buildRegistry } from '../../extensions';
import type { StaffEvent } from '../../extensions/registry';
import type { RequestContext } from '../../lib/audit';
import { newAfterCommit } from '../booking/effects';
import { applyProviderStatus } from '../payments/payment-effects.service';
import { activatePeriod, createRenewalPeriod } from './period.service';
import { purchaseSubscription } from './purchase.service';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

// Monday 2026-10-26 09:00 BRT.
const NOW = new Date('2026-10-26T12:00:00.000Z');
let staff: { event: StaffEvent; entityId: string }[] = [];
const registry = () => ({
  ...buildRegistry(),
  notifications: {
    notifyStaff: (event: StaffEvent, payload: { entityId: string }) => {
      staff.push({ event, entityId: payload.entityId });
      return Promise.resolve();
    },
  },
});
const deps = (now = NOW) => ({
  db,
  env: testEnv(),
  fetch: forbiddenFetch,
  now: () => now,
  registry: registry(),
});
const ctx: RequestContext = {
  actorUserId: null,
  actorRole: null,
  origin: 'job',
  ip: null,
  requestId: null,
};

beforeEach(async () => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  staff = [];
  await runSeed(db);
});

const seeded = async (name: string) => {
  const [row] = await db.select().from(bookingCategories).where(eq(bookingCategories.name, name));
  if (row === undefined) throw new Error(`no seeded category ${name}`);
  return row;
};

async function buy(body: Partial<SubscriptionPurchaseInput> & { categoryId: string }) {
  const { user } = await createTenant(db, { now: NOW });
  const result = await purchaseSubscription(
    deps(),
    { ...ctx, actorUserId: user.id, origin: 'app' },
    { ip: null, userAgent: null },
    {
      userId: user.id,
      source: 'app',
      body: {
        baseOn: '2026-11-02',
        paymentMethod: 'pix',
        acceptTerms: true,
        acceptRecurring: true,
        ...body,
      },
    },
  );
  if (result.charge === null) throw new Error('expected a charge');
  return { user, subscriptionId: result.subscriptionId, charge: result.charge };
}

const approve = (chargeId: string, amountCents: number, now = NOW) =>
  applyProviderStatus(deps(now), {
    provider: 'sandbox',
    chargeId,
    status: 'approved',
    amountCents,
  });

const subscriptionOf = async (id: string) =>
  (await db.select().from(subscriptions).where(eq(subscriptions.id, id)))[0];
const periodsOf = (subscriptionId: string) =>
  db
    .select()
    .from(subscriptionPeriods)
    .where(eq(subscriptionPeriods.subscriptionId, subscriptionId))
    .orderBy(subscriptionPeriods.seq);
const outbox = (template: string) =>
  db.select().from(emailOutbox).where(eq(emailOutbox.template, template));

async function pendingCharge(userId: string, periodId: string, amountCents: number) {
  const [row] = await db
    .insert(charges)
    .values({
      provider: 'sandbox',
      externalId: `sbx_${randomUUID()}`,
      purpose: 'subscription_renewal',
      method: 'pix',
      userId,
      subscriptionPeriodId: periodId,
      amountCents,
      status: 'pending',
      idempotencyKey: `ch_${randomUUID()}`,
    })
    .returning();
  if (row === undefined) throw new Error('charge insert returned no row');
  return row;
}

describe('subscription_initial approval (REC-16, REC-88, REC-160)', () => {
  it('base date today: subscription and period active with 1200 min, coupon consumed, e-mail and staff event', async () => {
    const pkg = await seeded('Pacote 20h mensal');
    const coupon = await createCoupon(db, { code: 'DEZPCT', appliesTo: 'packages' });
    const { subscriptionId, charge } = await buy({
      categoryId: pkg.id,
      baseOn: '2026-10-26',
      couponCode: 'DEZPCT',
    });
    const outcome = await approve(charge.id, charge.amountCents);
    expect(outcome.outcome).toBe('applied');
    expect(await subscriptionOf(subscriptionId)).toMatchObject({
      status: 'active',
      holdExpiresAt: null,
    });
    const [period] = await periodsOf(subscriptionId);
    expect(period).toMatchObject({ status: 'active', minutesBalance: 1200 });
    const [use] = await db.select().from(couponUses).where(eq(couponUses.couponId, coupon.id));
    expect(use?.status).toBe('consumed');
    expect(await outbox('subscription.activated')).toHaveLength(1);
    expect(staff).toContainEqual({ event: 'new_subscription', entityId: subscriptionId });
  });

  it('future base date: period paid, no minutes yet', async () => {
    const pkg = await seeded('Pacote 20h mensal');
    const { subscriptionId, charge } = await buy({ categoryId: pkg.id });
    await approve(charge.id, charge.amountCents);
    expect((await subscriptionOf(subscriptionId))?.status).toBe('active');
    const [period] = await periodsOf(subscriptionId);
    expect(period).toMatchObject({ status: 'paid', minutesBalance: 0 });
    expect(period?.paidAt?.toISOString()).toBe(NOW.toISOString());
  });

  it('fixed schedule: 22 occurrences confirmed and one e-mail with an .ics of 22 VEVENTs', async () => {
    const meio = await seeded('Meio turno mensal');
    const room = await seededRoom(db);
    const { subscriptionId, charge } = await buy({ categoryId: meio.id, roomId: room.id });
    await approve(charge.id, charge.amountCents);
    const occurrences = await db
      .select()
      .from(bookings)
      .where(eq(bookings.subscriptionId, subscriptionId));
    expect(occurrences).toHaveLength(22);
    expect(new Set(occurrences.map((b) => b.status))).toEqual(new Set(['confirmed']));
    const mails = await outbox('subscription.activated');
    expect(mails).toHaveLength(1);
    const attachments = mails[0]?.attachments as { contentBase64: string; filename: string }[];
    expect(attachments).toHaveLength(1);
    const ics = Buffer.from(attachments[0]?.contentBase64 ?? '', 'base64').toString('utf8');
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(22);
    expect(mails[0]?.textBody).toContain('22 ocorrências');
  });

  it('a duplicate webhook changes nothing the second time', async () => {
    const pkg = await seeded('Pacote 20h mensal');
    const { subscriptionId, charge } = await buy({ categoryId: pkg.id, baseOn: '2026-10-26' });
    await approve(charge.id, charge.amountCents);
    const second = await approve(charge.id, charge.amountCents);
    expect(second.outcome).toBe('noop');
    const grants = await db
      .select()
      .from(packageLedger)
      .where(eq(packageLedger.subscriptionId, subscriptionId));
    expect(grants).toHaveLength(1);
    expect(await outbox('subscription.activated')).toHaveLength(1);
  });

  it('approval of an expired subscription is refunded in full with payment.late_refund (REC-19)', async () => {
    const pkg = await seeded('Pacote 20h mensal');
    const { subscriptionId, charge } = await buy({ categoryId: pkg.id });
    await db
      .update(subscriptions)
      .set({ status: 'expired' })
      .where(eq(subscriptions.id, subscriptionId));
    await approve(charge.id, charge.amountCents);
    expect((await subscriptionOf(subscriptionId))?.status).toBe('expired');
    const [refund] = await db.select().from(refunds).where(eq(refunds.chargeId, charge.id));
    expect(refund).toMatchObject({ amountCents: 160_000, reason: 'late_approval_conflict' });
    const mails = await outbox('payment.late_refund');
    expect(mails).toHaveLength(1);
    expect(mails[0]?.textBody).toContain(formatBRL(160_000));
  });

  it('a saved card is charged at once and activates the subscription in the same request', async () => {
    const pkg = await seeded('Pacote 20h mensal');
    const { user } = await createTenant(db, { now: NOW });
    await db
      .insert(paymentCustomers)
      .values({ userId: user.id, provider: 'sandbox', externalCustomerId: `cus_${user.id}` });
    const [card] = await db
      .insert(savedCards)
      .values({
        userId: user.id,
        provider: 'sandbox',
        externalCardId: `sbx_card_4242_${randomUUID()}`,
        last4: '4242',
        recurringConsentAt: NOW,
      })
      .returning();
    const result = await purchaseSubscription(
      deps(),
      { ...ctx, actorUserId: user.id, origin: 'app' },
      { ip: null, userAgent: null },
      {
        userId: user.id,
        source: 'app',
        body: {
          categoryId: pkg.id,
          baseOn: '2026-10-26',
          paymentMethod: 'saved_card',
          savedCardId: card?.id ?? '',
          acceptTerms: true,
          acceptRecurring: true,
        },
      },
    );
    expect(result.charge?.status).toBe('approved');
    expect((await subscriptionOf(result.subscriptionId))?.status).toBe('active');
  });
});

describe('subscription_renewal outcomes (REC-49, REC-50, REC-56, REC-160)', () => {
  async function hourRenewal(subscriptionStatus = 'active') {
    const { user } = await createTenant(db, { now: NOW });
    const category = await seeded('Pacote 20h mensal');
    const { subscription } = await createSubscription(db, {
      userId: user.id,
      category,
      status: subscriptionStatus,
      period: { status: 'active', minutesBalance: 300 },
    });
    const renewal = await withTransaction(db, (tx) =>
      createRenewalPeriod(tx, subscription.id, NOW),
    );
    if (renewal === null) throw new Error('no renewal period');
    const charge = await pendingCharge(user.id, renewal.id, renewal.priceCents);
    return { user, subscription, renewal, charge };
  }

  it('approval before starts_on: period paid and subscription.renewal_approved queued', async () => {
    const { renewal, charge } = await hourRenewal();
    await approve(charge.id, charge.amountCents, new Date('2026-11-30T09:00:00Z'));
    const [row] = await db
      .select()
      .from(subscriptionPeriods)
      .where(eq(subscriptionPeriods.id, renewal.id));
    expect(row).toMatchObject({ status: 'paid', minutesBalance: 0 });
    expect(await outbox('subscription.renewal_approved')).toHaveLength(1);
  });

  it('fixed renewal approval confirms the held occurrences of the period', async () => {
    const { user } = await createTenant(db, { now: NOW });
    const category = await seeded('Meio turno mensal');
    const room = await seededRoom(db);
    const { subscription, period } = await createSubscription(db, {
      userId: user.id,
      category,
      roomId: room.id,
      period: { status: 'paid' },
    });
    await withTransaction(db, (tx) =>
      activatePeriod(tx, ctx, period?.id ?? '', {
        now: NOW,
        appBaseUrl: 'http://localhost:5173',
        fx: newAfterCommit(),
      }),
    );
    const renewal = await withTransaction(db, (tx) =>
      createRenewalPeriod(tx, subscription.id, NOW),
    );
    const charge = await pendingCharge(user.id, renewal?.id ?? '', renewal?.priceCents ?? 0);
    await approve(charge.id, charge.amountCents, new Date('2026-11-30T09:00:00Z'));
    const held = await db
      .select()
      .from(bookings)
      .where(eq(bookings.subscriptionPeriodId, renewal?.id ?? ''));
    expect(held).toHaveLength(22);
    expect(new Set(held.map((b) => b.status))).toEqual(new Set(['confirmed']));
    const [row] = await periodsOf(subscription.id).then((p) => p.filter((x) => x.seq === 2));
    expect(row?.status).toBe('paid');
  });

  it('rejection queues subscription.renewal_failed and the staff event renewal_failed', async () => {
    const { subscription, renewal, charge } = await hourRenewal();
    const outcome = await applyProviderStatus(deps(), {
      provider: 'sandbox',
      chargeId: charge.id,
      status: 'rejected',
    });
    expect(outcome.outcome).toBe('applied');
    const mails = await outbox('subscription.renewal_failed');
    expect(mails).toHaveLength(1);
    expect(mails[0]?.textBody).toContain(`/app/compras/assinaturas/${subscription.id}/pagar`);
    expect(staff).toContainEqual({ event: 'renewal_failed', entityId: subscription.id });
    const [row] = await db
      .select()
      .from(subscriptionPeriods)
      .where(eq(subscriptionPeriods.id, renewal.id));
    expect(row?.status).toBe('awaiting_payment');
  });

  it('approval during suspension regularizes: subscription and period active with full minutes', async () => {
    const { subscription, renewal, charge } = await hourRenewal('suspended');
    await approve(charge.id, charge.amountCents, new Date('2026-12-04T12:00:00Z'));
    expect(await subscriptionOf(subscription.id)).toMatchObject({
      status: 'active',
      suspendedAt: null,
    });
    const periods = await periodsOf(subscription.id);
    expect(periods.map((p) => [p.seq, p.status, p.minutesBalance])).toEqual([
      [1, 'closed', 0],
      [2, 'active', 1200],
    ]);
    expect(periods[1]).toMatchObject({ startsOn: renewal.startsOn, endsOn: renewal.endsOn });
  });

  it('approval after the subscription ended is refunded in full', async () => {
    const { subscription, renewal, charge } = await hourRenewal();
    await db
      .update(subscriptions)
      .set({ status: 'ended' })
      .where(eq(subscriptions.id, subscription.id));
    await db
      .update(subscriptionPeriods)
      .set({ status: 'failed' })
      .where(eq(subscriptionPeriods.id, renewal.id));
    await approve(charge.id, charge.amountCents, new Date('2026-12-10T12:00:00Z'));
    const [refund] = await db
      .select()
      .from(refunds)
      .where(and(eq(refunds.chargeId, charge.id), eq(refunds.reason, 'late_approval_conflict')));
    expect(refund?.amountCents).toBe(160_000);
    expect(await outbox('payment.late_refund')).toHaveLength(1);
  });
});
