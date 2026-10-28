import { randomUUID } from 'node:crypto';
import { formatBRL, settingDefaults, type SubscriptionPurchaseInput } from '@bravo/core';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCharge, createStaff, createTenant, seededRoom } from '../../../test/booking-helpers';
import { createBooking as insertBooking } from '../../../test/factories';
import { createSubscription } from '../../../test/factories/revenue';
import { forbiddenFetch, send, testEnv } from '../../../test/http';
import { requireTestDatabaseUrl } from '../../../test/require-test-db';
import { createApp } from '../../app';
import { createDb, withTransaction } from '../../db/client';
import {
  bookingCategories,
  charges,
  emailOutbox,
  extraServices,
  notificationRecipients,
  pushSubscriptions,
} from '../../db/schema';
import { runSeed } from '../../db/seed';
import { buildRegistry } from '../../extensions';
import type { StaffEvent } from '../../extensions/registry';
import { chargeBalances } from '../../jobs/charge-balances';
import { expireHolds } from '../../jobs/expire-holds';
import { JOB_CONTEXT } from '../../jobs/runner';
import type { WebPushClient } from '../../lib/push';
import { buildSandboxWebhook } from '../../payments/adapters/sandbox';
import { applyProviderStatus } from '../payments/payment-effects.service';
import { saveSetting } from '../settings/settings.repo';
import { createRenewalPeriod } from '../subscriptions/period.service';
import { purchaseSubscription } from '../subscriptions/purchase.service';

// T43 (GES-69, R7, R8): núcleo and receita notices reach gestao's `emit` through the registered
// `NotificationPort` and the rewired mailers. Every test runs with the app's own registry.

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

const NOW = new Date('2026-10-20T12:00:00.000Z');
const HOUR = 3_600_000;
const after = (hours: number) => new Date(NOW.getTime() + hours * HOUR);
const env = testEnv({
  VAPID_PUBLIC_KEY: 'BPublicKeyForTests',
  VAPID_PRIVATE_KEY: 'private-key-for-tests',
  VAPID_SUBJECT: 'mailto:ops@bravoclinic.test',
});

let sendNotification = vi.fn();
let recipients: { id: string; email: string }[] = [];
let roomId = '';

beforeEach(async () => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  sendNotification = vi.fn(() => Promise.resolve({ statusCode: 201 }));
  await runSeed(db);
  roomId = (await seededRoom(db)).id;
  recipients = await db
    .insert(notificationRecipients)
    .values([{ email: 'gerencia@bravoclinic.test' }, { email: 'recepcao@bravoclinic.test' }])
    .returning({ id: notificationRecipients.id, email: notificationRecipients.email });
});

const webPush = (): WebPushClient => ({ sendNotification });
const base = (now: Date) => ({
  db,
  env,
  fetch: forbiddenFetch,
  now: () => now,
  webPush: webPush(),
});
/** Job/service deps with the production registry (staff port bound to the same deps). */
const appDeps = (now: Date) => ({ ...base(now), registry: buildRegistry(base(now)) });
const buildApp = (now = NOW) => createApp(base(now));

const staffMails = (event: StaffEvent | 'new_quote_request') =>
  db
    .select()
    .from(emailOutbox)
    .where(eq(emailOutbox.template, `staff.${event}`));

/** Exactly one `staff.<event>` e-mail per active recipient, keyed by the entity (GES-67). */
async function expectEmittedOnce(event: StaffEvent | 'new_quote_request', entityId: string) {
  const rows = await staffMails(event);
  expect(rows.map((row) => row.dedupeKey).sort()).toEqual(
    recipients.map((r) => `staff:${event}:${entityId}:${r.id}`).sort(),
  );
  expect(rows.map((row) => row.toAddress).sort()).toEqual(recipients.map((r) => r.email).sort());
  return rows;
}

// --- núcleo triggers --------------------------------------------------------------------------

/** An `awaiting_payment` booking of 219,00 (sinal 109,50) on 27/10 10:00 and its pending Pix. */
async function awaitingDeposit() {
  const { user } = await createTenant(db, { now: NOW, name: 'Beatriz Lima' });
  const booking = await insertBooking(db, {
    userId: user.id,
    roomId,
    startsAt: new Date('2026-10-27T13:00:00.000Z'),
    endsAt: new Date('2026-10-27T15:00:00.000Z'),
    status: 'awaiting_payment',
    totalCents: 21900,
    depositCents: 10950,
    paidCents: 0,
    holdExpiresAt: after(0.25),
    balanceDueAt: new Date('2026-10-26T13:00:00.000Z'),
  });
  const id = randomUUID();
  const [charge] = await db
    .insert(charges)
    .values({
      id,
      provider: 'sandbox',
      externalId: `sbx_${id}`,
      purpose: 'booking_deposit',
      method: 'pix',
      userId: user.id,
      bookingId: booking.id,
      amountCents: 10950,
      status: 'pending',
      expiresAt: after(0.25),
      idempotencyKey: `ch_${id}`,
    })
    .returning();
  if (charge === undefined) throw new Error('charge insert failed');
  return { user, booking, charge };
}

async function deliverSandbox(charge: { id: string }, amountCents?: number) {
  const delivery = buildSandboxWebhook(
    {
      chargeId: charge.id,
      externalId: `sbx_${charge.id}`,
      status: 'approved',
      ...(amountCents !== undefined && { amountCents }),
    },
    env,
  );
  const response = await buildApp().request('/webhooks/pagamentos/sandbox', {
    method: 'POST',
    headers: delivery.headers,
    body: delivery.rawBody,
  });
  return response.status;
}

describe('núcleo staff events through the port (GES-69)', () => {
  it('webhook approval: payment_received and new_booking once each, a replayed delivery adds none', async () => {
    const { booking, charge } = await awaitingDeposit();

    expect(await deliverSandbox(charge)).toBe(200);
    expect(await deliverSandbox(charge)).toBe(200);

    const received = await expectEmittedOnce('payment_received', charge.id);
    expect(received[0]?.textBody).toContain(`Beatriz pagou ${formatBRL(10950)}`);
    const created = await expectEmittedOnce('new_booking', booking.id);
    expect(created[0]?.textBody).toContain(booking.code);
    expect(created[0]?.textBody).toContain('27/10/2026');
  });

  it('confirmation still queues booking.confirmed with its .ics and now also pushes (R7)', async () => {
    const { user, booking, charge } = await awaitingDeposit();
    await db.insert(pushSubscriptions).values({
      userId: user.id,
      endpoint: 'https://push.example/ana',
      p256dh: 'BKey',
      auth: 'auth',
    });

    expect(await deliverSandbox(charge)).toBe(200);
    expect(await deliverSandbox(charge)).toBe(200);

    const mails = await db
      .select()
      .from(emailOutbox)
      .where(eq(emailOutbox.template, 'booking.confirmed'));
    expect(mails).toHaveLength(1);
    expect(mails[0]).toMatchObject({
      toAddress: user.email,
      dedupeKey: `booking.confirmed:${booking.id}`,
    });
    const [attachment] = mails[0]?.attachments as { contentType: string; contentBase64: string }[];
    expect(attachment?.contentType).toBe('text/calendar; charset=utf-8; method=REQUEST');
    const ics = Buffer.from(attachment?.contentBase64 ?? '', 'base64').toString('utf8');
    expect(ics).toContain('METHOD:REQUEST');
    expect(ics).toContain(`UID:${booking.icsUid}`);
    expect(sendNotification).toHaveBeenCalledTimes(1);
    const [subscription, payload] = sendNotification.mock.calls[0] as [
      { endpoint: string },
      string,
    ];
    expect(subscription.endpoint).toBe('https://push.example/ana');
    expect(JSON.parse(payload)).toEqual({
      title: 'Reserva confirmada',
      body: 'Sua reserva de 27/10/2026 10:00 está confirmada.',
      url: `/app/minhas-reservas/${booking.id}`,
      tag: 'booking.confirmed',
    });
  });

  it('manual confirmation emits new_booking once', async () => {
    const { user } = await createTenant(db, { now: NOW });
    const booking = await insertBooking(db, {
      userId: user.id,
      roomId,
      startsAt: after(48),
      endsAt: after(50),
      status: 'pre_reserved',
      paidCents: 0,
      holdExpiresAt: after(24),
    });
    const admin = await createStaff(db, 'admin', NOW);

    const res = await send(buildApp(), 'POST', `/admin/bookings/${booking.id}/confirm-manual`, {
      cookie: admin.cookie,
      body: { justification: 'Pagamento recebido no balcão' },
    });

    expect(res.status).toBe(200);
    await expectEmittedOnce('new_booking', booking.id);
  });

  it('cancellation by the tenant emits booking_cancelled once', async () => {
    const { user, cookie } = await createTenant(db, { now: NOW });
    const booking = await insertBooking(db, {
      userId: user.id,
      roomId,
      startsAt: after(30),
      endsAt: after(32),
      totalCents: 16000,
      depositCents: 8000,
      paidCents: 8000,
    });
    await createCharge(db, {
      userId: user.id,
      bookingId: booking.id,
      purpose: 'booking_deposit',
      amountCents: 8000,
      approvedAt: after(-100),
    });

    const res = await send(buildApp(), 'POST', `/app/bookings/${booking.id}/cancel`, {
      cookie,
      body: { reason: 'Imprevisto' },
      headers: { 'Idempotency-Key': randomUUID() },
    });

    expect(res.status).toBe(200);
    await expectEmittedOnce('booking_cancelled', booking.id);
  });

  it('cancellation by the clinic emits booking_cancelled once', async () => {
    const { user } = await createTenant(db, { now: NOW });
    const booking = await insertBooking(db, {
      userId: user.id,
      roomId,
      startsAt: after(10),
      endsAt: after(12),
      totalCents: 16000,
      depositCents: 8000,
      paidCents: 8000,
    });
    await createCharge(db, {
      userId: user.id,
      bookingId: booking.id,
      purpose: 'booking_deposit',
      amountCents: 8000,
      approvedAt: after(-100),
    });
    const admin = await createStaff(db, 'admin', NOW);

    const res = await send(buildApp(), 'POST', `/admin/bookings/${booking.id}/cancel`, {
      cookie: admin.cookie,
      body: { reason: 'Manutenção da sala', resolution: 'refund' },
    });

    expect(res.status).toBe(200);
    await expectEmittedOnce('booking_cancelled', booking.id);
  });

  it('cancellation for non-payment (charge-balances job) emits booking_cancelled once', async () => {
    const { user } = await createTenant(db, { now: NOW });
    const starts = after(24);
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

    const stats = await chargeBalances(appDeps(NOW), NOW);
    await chargeBalances(appDeps(NOW), NOW);

    expect(stats).toMatchObject({ cancelledNonpayment: 1 });
    await expectEmittedOnce('booking_cancelled', booking.id);
  });

  it('the expire-holds job emits pre_reservation_expired once', async () => {
    const { user } = await createTenant(db, { now: NOW });
    const booking = await insertBooking(db, {
      userId: user.id,
      roomId,
      startsAt: after(48),
      endsAt: after(49),
      status: 'pre_reserved',
      paidCents: 0,
      holdExpiresAt: after(-0.1),
    });

    const stats = await expireHolds(appDeps(NOW), NOW);
    await expireHolds(appDeps(NOW), NOW);

    expect(stats).toMatchObject({ expiredPreReservations: 1 });
    await expectEmittedOnce('pre_reservation_expired', booking.id);
  });
});

// --- receita triggers -------------------------------------------------------------------------

// Monday 2026-10-26 09:00 BRT (receita's charge-handler fixtures).
const MONDAY = new Date('2026-10-26T12:00:00.000Z');

const seededCategory = async (name: string) => {
  const [row] = await db.select().from(bookingCategories).where(eq(bookingCategories.name, name));
  if (row === undefined) throw new Error(`no seeded category ${name}`);
  return row;
};

describe('receita staff events through the port (GES-69)', () => {
  it('the first subscription payment emits new_subscription once', async () => {
    const pkg = await seededCategory('Pacote 20h mensal');
    const { user } = await createTenant(db, { now: MONDAY });
    const body: SubscriptionPurchaseInput = {
      categoryId: pkg.id,
      baseOn: '2026-10-26',
      paymentMethod: 'pix',
      acceptTerms: true,
      acceptRecurring: true,
    };
    const result = await purchaseSubscription(
      appDeps(MONDAY),
      { ...JOB_CONTEXT, actorUserId: user.id, origin: 'app' },
      { ip: null, userAgent: null },
      { userId: user.id, source: 'app', body },
    );
    const charge = result.charge;
    if (charge === null) throw new Error('expected a charge');
    const approve = () =>
      applyProviderStatus(appDeps(MONDAY), {
        provider: 'sandbox',
        chargeId: charge.id,
        status: 'approved',
        amountCents: charge.amountCents,
      });

    expect((await approve()).outcome).toBe('applied');
    await approve();

    const rows = await expectEmittedOnce('new_subscription', result.subscriptionId);
    expect(rows[0]?.textBody).toContain('Pacote 20h mensal');
    await expectEmittedOnce('payment_received', charge.id);
  });

  it('a failed renewal emits renewal_failed once', async () => {
    const { user } = await createTenant(db, { now: MONDAY, name: 'Carla Dias' });
    const category = await seededCategory('Pacote 20h mensal');
    const { subscription } = await createSubscription(db, {
      userId: user.id,
      category,
      period: { status: 'active', minutesBalance: 300 },
    });
    const renewal = await withTransaction(db, (tx) =>
      createRenewalPeriod(tx, subscription.id, MONDAY),
    );
    if (renewal === null) throw new Error('no renewal period');
    const [charge] = await db
      .insert(charges)
      .values({
        provider: 'sandbox',
        externalId: `sbx_${randomUUID()}`,
        purpose: 'subscription_renewal',
        method: 'pix',
        userId: user.id,
        subscriptionPeriodId: renewal.id,
        amountCents: renewal.priceCents,
        status: 'pending',
        idempotencyKey: `ch_${randomUUID()}`,
      })
      .returning();
    if (charge === undefined) throw new Error('charge insert failed');
    const reject = () =>
      applyProviderStatus(appDeps(MONDAY), {
        provider: 'sandbox',
        chargeId: charge.id,
        status: 'rejected',
      });

    expect((await reject()).outcome).toBe('applied');
    await reject();

    const rows = await expectEmittedOnce('renewal_failed', subscription.id);
    expect(rows[0]?.textBody).toContain(
      `A renovação de Pacote 20h mensal de Carla (${formatBRL(renewal.priceCents)})`,
    );
  });
});

// --- gestao trigger and the untoggled event -----------------------------------------------------

describe('quote requests and payment issues (GES-69, GES-68)', () => {
  it('a quote request emits new_quote_request once', async () => {
    const [service] = await db
      .select()
      .from(extraServices)
      .where(eq(extraServices.name, 'Videomaker'));

    const res = await send(buildApp(), 'POST', '/public/quote-requests', {
      body: {
        serviceId: service?.id,
        name: 'Ana Souza',
        phone: '(47) 99999-1234',
        description: 'Quero gravar quatro vídeos curtos para Reels.',
        website: '',
      },
      headers: { 'X-Forwarded-For': '198.51.100.77' },
    });

    expect(res.status).toBe(201);
    await expectEmittedOnce('new_quote_request', (res.body as { id: string }).id);
  });

  it('payment_issue reaches every recipient with every toggle off; toggled events stay silent', async () => {
    const allOff = Object.fromEntries(
      Object.keys(settingDefaults()['notifications.events']).map((key) => [key, false]),
    ) as ReturnType<typeof settingDefaults>['notifications.events'];
    await withTransaction(db, (tx) => saveSetting(tx, 'notifications.events', allOff, null));
    const { charge } = await awaitingDeposit();

    // The provider reports a different amount: the charge is flagged, not applied.
    expect(await deliverSandbox(charge, 5000)).toBe(200);

    const rows = await expectEmittedOnce('payment_issue', charge.id);
    expect(rows[0]?.subject).not.toBe('');
    expect(await staffMails('payment_received')).toHaveLength(0);
    expect(await staffMails('new_booking')).toHaveLength(0);
  });
});
