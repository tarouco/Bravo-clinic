import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createBooking, createUser } from '../../../test/factories';
import { forbiddenFetch, testEnv } from '../../../test/http';
import { requireTestDatabaseUrl } from '../../../test/require-test-db';
import { createApp } from '../../app';
import { createDb } from '../../db/client';
import {
  auditLog,
  bookingEvents,
  bookings,
  charges,
  emailOutbox,
  paymentCustomers,
  savedCards,
  refunds,
  roomOccupancy,
  rooms,
  webhookEvents,
} from '../../db/schema';
import { runSeed } from '../../db/seed';
import { submitCharge } from '../../modules/payments/charges.service';
import {
  createRegistry,
  type ChargeHandler,
  type ChargePurposeHandled,
  type Registry,
  type StaffEvent,
} from '../../extensions/registry';
import {
  SANDBOX_SIGNATURE_HEADER,
  buildSandboxWebhook,
  type SandboxWebhookPayload,
} from '../../payments/adapters/sandbox';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

const NOW = new Date('2026-10-20T12:00:00.000Z');
const STARTS = new Date('2026-10-27T13:00:00.000Z');
const ENDS = new Date('2026-10-27T15:00:00.000Z');
const env = testEnv();

let roomId = '';

beforeEach(async () => {
  await runSeed(db);
  const [room] = await db.select().from(rooms).limit(1);
  roomId = room?.id ?? '';
});

interface NotifierCall {
  event: StaffEvent;
  entityId: string;
  bookingStatusAtCall: string | undefined;
}

/** A registry whose notifier records each call and the booking status it can see (post-commit). */
function recordingRegistry(overrides: Partial<Registry> = {}) {
  const calls: NotifierCall[] = [];
  const registry = createRegistry({
    notifications: {
      notifyStaff: async (event, payload) => {
        const [booking] = await db.select().from(bookings);
        calls.push({ event, entityId: payload.entityId, bookingStatusAtCall: booking?.status });
      },
    },
    ...overrides,
  });
  return { registry, calls };
}

const buildApp = (registry: Registry = createRegistry()) =>
  createApp({ db, now: () => NOW, fetch: forbiddenFetch, env, registry });

async function deliver(
  app: ReturnType<typeof buildApp>,
  provider: string,
  delivery: { headers: Record<string, string>; rawBody: string },
) {
  const response = await app.request(`/webhooks/pagamentos/${provider}`, {
    method: 'POST',
    headers: delivery.headers,
    body: delivery.rawBody,
  });
  const text = await response.text();
  return { status: response.status, body: text === '' ? null : (JSON.parse(text) as unknown) };
}

const sandboxEvent = (
  charge: { id: string },
  status: SandboxWebhookPayload['status'],
  amountCents?: number,
) =>
  buildSandboxWebhook(
    {
      chargeId: charge.id,
      externalId: `sbx_${charge.id}`,
      status,
      ...(amountCents !== undefined && { amountCents }),
    },
    env,
  );

/** A tenant, an `awaiting_payment` booking of 219,00 (sinal 109,50) and its pending Pix charge. */
async function setup(
  bookingOverrides: Partial<Parameters<typeof createBooking>[1]> = {},
  chargeOverrides: Partial<typeof charges.$inferInsert> = {},
) {
  const user = await createUser(db, { email: 'ana@bravoclinic.test', name: 'Ana Souza' });
  const booking = await createBooking(db, {
    userId: user.id,
    roomId,
    startsAt: STARTS,
    endsAt: ENDS,
    status: 'awaiting_payment',
    totalCents: 21900,
    depositCents: 10950,
    paidCents: 0,
    holdExpiresAt: new Date('2026-10-20T12:15:00.000Z'),
    balanceDueAt: new Date('2026-10-26T13:00:00.000Z'),
    ...bookingOverrides,
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
      expiresAt: new Date('2026-10-20T12:15:00.000Z'),
      idempotencyKey: `ch_${id}`,
      ...chargeOverrides,
    })
    .returning();
  if (charge === undefined) throw new Error('charge insert failed');
  return { user, booking, charge };
}

const bookingOf = async (id: string) => {
  const [row] = await db.select().from(bookings).where(eq(bookings.id, id));
  if (row === undefined) throw new Error('booking missing');
  return row;
};
const chargeOf = async (id: string) => {
  const [row] = await db.select().from(charges).where(eq(charges.id, id));
  if (row === undefined) throw new Error('charge missing');
  return row;
};

describe('webhook authenticity and idempotency (NUC-112, NUC-113)', () => {
  it('answers 401 for an invalid signature and stores no webhook_events row', async () => {
    const { charge, booking } = await setup();
    const { rawBody } = sandboxEvent(charge, 'approved');

    const res = await deliver(buildApp(), 'sandbox', {
      headers: { [SANDBOX_SIGNATURE_HEADER]: 'f'.repeat(64) },
      rawBody,
    });

    expect(res.status).toBe(401);
    expect(await db.select().from(webhookEvents)).toHaveLength(0);
    expect((await bookingOf(booking.id)).status).toBe('awaiting_payment');
  });

  it('answers 401 for a tampered body and for a delivery with no signature', async () => {
    const { charge } = await setup();
    const { headers, rawBody } = sandboxEvent(charge, 'rejected');

    const tampered = await deliver(buildApp(), 'sandbox', {
      headers,
      rawBody: rawBody.replace('rejected', 'approved'),
    });
    const unsigned = await deliver(buildApp(), 'sandbox', { headers: {}, rawBody });

    expect([tampered.status, unsigned.status]).toEqual([401, 401]);
    expect(await db.select().from(webhookEvents)).toHaveLength(0);
  });

  it('answers 404 for an unknown provider', async () => {
    const res = await deliver(buildApp(), 'paypal', { headers: {}, rawBody: '{}' });

    expect(res.status).toBe(404);
  });

  it('answers 401 for Mercado Pago while it has no credentials', async () => {
    const res = await deliver(buildApp(), 'mercadopago', { headers: {}, rawBody: '{}' });

    expect(res.status).toBe(401);
  });

  it('processes a repeated delivery once', async () => {
    const { charge, booking } = await setup();
    const app = buildApp();
    const delivery = sandboxEvent(charge, 'approved');

    const first = await deliver(app, 'sandbox', delivery);
    const second = await deliver(app, 'sandbox', delivery);

    expect([first.status, second.status]).toEqual([200, 200]);
    expect(await db.select().from(webhookEvents)).toHaveLength(1);
    expect((await bookingOf(booking.id)).paidCents).toBe(10950);
    expect(await db.select().from(bookingEvents)).toHaveLength(1);
    expect(await db.select().from(emailOutbox)).toHaveLength(1);
  });

  it('processes two concurrent deliveries of the same approval exactly once', async () => {
    const { charge, booking } = await setup();
    const app = buildApp();
    const delivery = sandboxEvent(charge, 'approved');

    const results = await Promise.all([
      deliver(app, 'sandbox', delivery),
      deliver(app, 'sandbox', delivery),
    ]);

    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect((await bookingOf(booking.id)).paidCents).toBe(10950);
    expect(await db.select().from(bookingEvents)).toHaveLength(1);
    expect(await db.select().from(emailOutbox)).toHaveLength(1);
  });

  it('answers 200 and changes nothing for a valid delivery of an unknown charge', async () => {
    const res = await deliver(
      buildApp(),
      'sandbox',
      sandboxEvent({ id: randomUUID() }, 'approved'),
    );

    expect(res.status).toBe(200);
    expect(await db.select().from(charges)).toHaveLength(0);
  });
});

describe('approved booking charges (NUC-115, NUC-136)', () => {
  it('confirms the booking on an approved deposit, with mail, event and post-commit notices', async () => {
    const { charge, booking } = await setup();
    const { registry, calls } = recordingRegistry();

    const res = await deliver(
      buildApp(registry),
      'sandbox',
      sandboxEvent(charge, 'approved', 10950),
    );

    expect(res.status).toBe(200);
    const after = await bookingOf(booking.id);
    expect(after).toMatchObject({ status: 'confirmed', paidCents: 10950, balanceCents: 10950 });
    expect(await chargeOf(charge.id)).toMatchObject({
      status: 'approved',
      approvedAt: NOW,
      feeCents: 0,
    });

    const events = await db.select().from(bookingEvents);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      bookingId: booking.id,
      fromStatus: 'awaiting_payment',
      toStatus: 'confirmed',
      origin: 'system',
      reason: 'payment_approved',
    });
    expect(events[0]?.data).toMatchObject({ chargeId: charge.id, amountCents: 10950 });

    const mails = await db.select().from(emailOutbox);
    expect(mails).toHaveLength(1);
    expect(mails[0]).toMatchObject({
      template: 'booking.confirmed',
      toAddress: 'ana@bravoclinic.test',
      subject: `Reserva confirmada — ${booking.code}`,
    });
    const attachment = (mails[0]?.attachments as { filename: string; contentBase64: string }[])[0];
    expect(attachment?.filename).toBe(`reserva-${booking.code}.ics`);
    expect(Buffer.from(attachment?.contentBase64 ?? '', 'base64').toString('utf8')).toContain(
      'METHOD:REQUEST',
    );

    expect(calls.map((c) => [c.event, c.entityId, c.bookingStatusAtCall])).toEqual([
      ['payment_received', charge.id, 'confirmed'],
      ['new_booking', booking.id, 'confirmed'],
    ]);
  });

  it('settles a full-upfront booking as paid', async () => {
    const { charge, booking } = await setup(
      { paymentMode: 'full_upfront', depositCents: 21900 },
      { purpose: 'booking_full', amountCents: 21900 },
    );

    await deliver(buildApp(), 'sandbox', sandboxEvent(charge, 'approved', 21900));

    expect(await bookingOf(booking.id)).toMatchObject({
      status: 'paid',
      paidCents: 21900,
      balanceCents: 0,
    });
  });

  it('settles the balance of a confirmed booking as paid and mails booking.balance_charged', async () => {
    const { charge, booking } = await setup(
      { status: 'confirmed', paidCents: 10950, holdExpiresAt: null },
      { purpose: 'booking_balance', amountCents: 10950 },
    );
    const { registry, calls } = recordingRegistry();

    await deliver(buildApp(registry), 'sandbox', sandboxEvent(charge, 'approved', 10950));

    expect(await bookingOf(booking.id)).toMatchObject({
      status: 'paid',
      paidCents: 21900,
      balanceCents: 0,
    });
    expect((await db.select().from(emailOutbox)).map((m) => m.template)).toEqual([
      'booking.balance_charged',
    ]);
    expect(calls.map((c) => c.event)).toEqual(['payment_received']);
  });

  it('runs each checkout step onConfirmed inside the confirmation', async () => {
    const { charge, booking } = await setup();
    const confirmedIds: string[] = [];
    const registry = createRegistry({
      checkoutSteps: [
        {
          name: 'probe',
          order: 100,
          apply: (_ctx, draft) => Promise.resolve(draft),
          onConfirmed: (_tx, row) => {
            confirmedIds.push(row.id);
            return Promise.resolve();
          },
        },
      ],
    });

    await deliver(buildApp(registry), 'sandbox', sandboxEvent(charge, 'approved'));

    expect(confirmedIds).toEqual([booking.id]);
  });

  it('marks a rejected charge rejected and keeps the booking awaiting payment (NUC-118)', async () => {
    const { charge, booking } = await setup();

    const res = await deliver(buildApp(), 'sandbox', sandboxEvent(charge, 'rejected'));

    expect(res.status).toBe(200);
    expect((await chargeOf(charge.id)).status).toBe('rejected');
    expect(await bookingOf(booking.id)).toMatchObject({ status: 'awaiting_payment', paidCents: 0 });
    expect(await db.select().from(emailOutbox)).toHaveLength(0);
  });
});

describe('staff notifier failures (NUC-205)', () => {
  it('is logged without failing the delivery or undoing the confirmation', async () => {
    const { charge, booking } = await setup();
    const registry = createRegistry({
      notifications: { notifyStaff: () => Promise.reject(new Error('push provider down')) },
    });

    const res = await deliver(
      buildApp(registry),
      'sandbox',
      sandboxEvent(charge, 'approved', 10950),
    );

    expect(res.status).toBe(200);
    expect((await bookingOf(booking.id)).status).toBe('confirmed');
    const [event] = await db.select().from(webhookEvents);
    expect(event?.processedAt).not.toBeNull();
  });
});

describe('amount mismatch (NUC-116)', () => {
  it('leaves the booking unchanged, audits payment.amount_mismatch and notifies staff', async () => {
    const { charge, booking } = await setup();
    const { registry, calls } = recordingRegistry();

    await deliver(buildApp(registry), 'sandbox', sandboxEvent(charge, 'approved', 5000));

    expect(await bookingOf(booking.id)).toMatchObject({ status: 'awaiting_payment', paidCents: 0 });
    expect(await db.select().from(bookingEvents)).toHaveLength(0);
    const [entry] = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'payment.amount_mismatch'));
    expect(entry).toMatchObject({ entityType: 'charge', entityId: charge.id });
    expect(entry?.after).toEqual({ expectedCents: 10950, receivedCents: 5000 });
    expect(calls.map((c) => [c.event, c.entityId])).toEqual([['payment_issue', charge.id]]);
  });
});

describe('late approval (NUC-117)', () => {
  it('reinstates an expired booking whose slot is still free', async () => {
    const { charge, booking } = await setup({ status: 'expired', occupancy: false });
    await db.insert(roomOccupancy).values({
      roomId,
      period: `[${STARTS.toISOString()},${new Date(ENDS.getTime() + 30 * 60_000).toISOString()})`,
      kind: 'booking',
      refId: booking.id,
      active: false,
    });

    await deliver(buildApp(), 'sandbox', sandboxEvent(charge, 'approved', 10950));

    expect(await bookingOf(booking.id)).toMatchObject({ status: 'confirmed', paidCents: 10950 });
    const [event] = await db.select().from(bookingEvents);
    expect(event).toMatchObject({
      fromStatus: 'expired',
      toStatus: 'confirmed',
      reason: 'late_approval',
    });
    const [occupancy] = await db
      .select()
      .from(roomOccupancy)
      .where(eq(roomOccupancy.refId, booking.id));
    expect(occupancy?.active).toBe(true);
    expect(await db.select().from(refunds)).toHaveLength(0);
  });

  it('refunds in full and mails three suggestions when another booking took the slot', async () => {
    const { charge, booking } = await setup({ status: 'expired', occupancy: false });
    await db.insert(roomOccupancy).values({
      roomId,
      period: `[${STARTS.toISOString()},${new Date(ENDS.getTime() + 30 * 60_000).toISOString()})`,
      kind: 'booking',
      refId: booking.id,
      active: false,
    });
    const other = await createUser(db, { email: 'bia@bravoclinic.test' });
    await createBooking(db, { userId: other.id, roomId, startsAt: STARTS, endsAt: ENDS });

    await deliver(buildApp(), 'sandbox', sandboxEvent(charge, 'approved', 10950));

    expect(await bookingOf(booking.id)).toMatchObject({ status: 'expired', paidCents: 0 });
    const [refund] = await db.select().from(refunds);
    expect(refund).toMatchObject({
      chargeId: charge.id,
      bookingId: booking.id,
      amountCents: 10950,
      reason: 'late_approval_conflict',
      status: 'approved',
    });
    expect(refund?.completedAt).toEqual(NOW);
    expect(await chargeOf(charge.id)).toMatchObject({ status: 'refunded', refundedCents: 10950 });
    // The refund of a payment that never reached the booking leaves paid_cents alone.
    expect((await bookingOf(booking.id)).paidCents).toBe(0);

    const [mail] = await db.select().from(emailOutbox);
    expect(mail).toMatchObject({
      template: 'booking.late_approval_refund',
      toAddress: 'ana@bravoclinic.test',
    });
    // The booking's own time is in the summary; the three alternatives follow "Horários livres".
    const suggestions = mail?.html.split('Horários livres com a mesma duração: ')[1] ?? '';
    const slots = suggestions.match(/\d{2}\/\d{2}\/\d{4} das \d{2}:\d{2} às \d{2}:\d{2}/g) ?? [];
    expect(slots).toHaveLength(3);
    // Same 2 h duration as the booking.
    for (const slot of slots) {
      const [, h1, m1, h2, m2] = /das (\d{2}):(\d{2}) às (\d{2}):(\d{2})/.exec(slot) ?? [];
      expect(Number(h2) * 60 + Number(m2) - (Number(h1) * 60 + Number(m1))).toBe(120);
    }
    expect(slots).not.toContain('27/10/2026 das 10:00 às 12:00');
  });
});

describe('charges of other purposes (NUC-209)', () => {
  function probe() {
    const log: { hook: string; status: string; inTransaction: string }[] = [];
    const handler: ChargeHandler = {
      onApproved: async (tx, _ctx, row) => {
        const [fresh] = await tx.select().from(charges).where(eq(charges.id, row.id));
        log.push({ hook: 'approved', status: row.status, inTransaction: fresh?.status ?? '' });
      },
      onFailed: (_tx, _ctx, row, status) => {
        log.push({ hook: 'failed', status, inTransaction: row.status });
        return Promise.resolve();
      },
    };
    const chargeHandlers: Partial<Record<ChargePurposeHandled, ChargeHandler>> = {
      extra_hours: handler,
    };
    return { log, registry: createRegistry({ chargeHandlers }) };
  }

  it('calls chargeHandlers.extra_hours.onApproved once, inside the transaction', async () => {
    const { charge } = await setup(
      {},
      { purpose: 'extra_hours', bookingId: null, amountCents: 30000 },
    );
    const { log, registry } = probe();
    const app = buildApp(registry);
    const delivery = sandboxEvent(charge, 'approved', 30000);

    await deliver(app, 'sandbox', delivery);
    await deliver(app, 'sandbox', delivery);

    expect(log).toEqual([{ hook: 'approved', status: 'approved', inTransaction: 'approved' }]);
    expect(await chargeOf(charge.id)).toMatchObject({ status: 'approved', approvedAt: NOW });
  });

  it('calls onFailed for a rejected extra_hours charge', async () => {
    const { charge } = await setup(
      {},
      { purpose: 'extra_hours', bookingId: null, amountCents: 30000 },
    );
    const { log, registry } = probe();

    await deliver(buildApp(registry), 'sandbox', sandboxEvent(charge, 'rejected'));

    expect(log).toEqual([{ hook: 'failed', status: 'rejected', inTransaction: 'rejected' }]);
  });

  it('notifies payment_received for any approved non-credit charge', async () => {
    const { charge } = await setup(
      {},
      { purpose: 'extra_hours', bookingId: null, amountCents: 30000 },
    );
    const { registry: base } = probe();
    const { registry, calls } = recordingRegistry({ chargeHandlers: base.chargeHandlers });

    await deliver(buildApp(registry), 'sandbox', sandboxEvent(charge, 'approved', 30000));

    expect(calls.map((c) => [c.event, c.entityId])).toEqual([['payment_received', charge.id]]);
  });
});

describe('immediate answers of a saved-card charge go through the same effects', () => {
  async function savedCardCharge(last4: string) {
    const { user, booking } = await setup({
      status: 'confirmed',
      paidCents: 10950,
      holdExpiresAt: null,
    });
    await db
      .insert(paymentCustomers)
      .values({ userId: user.id, provider: 'sandbox', externalCustomerId: `sbx_cus_${user.id}` });
    const [card] = await db
      .insert(savedCards)
      .values({
        userId: user.id,
        provider: 'sandbox',
        externalCardId: `sbx_card_${last4}_x`,
        brand: 'visa',
        last4,
        expMonth: 12,
        expYear: 2030,
        recurringConsentAt: NOW,
      })
      .returning();
    const id = randomUUID();
    const [charge] = await db
      .insert(charges)
      .values({
        id,
        provider: 'sandbox',
        purpose: 'booking_balance',
        method: 'saved_card',
        userId: user.id,
        bookingId: booking.id,
        amountCents: 10950,
        status: 'pending',
        idempotencyKey: `ch_${id}`,
        rawLast: { savedCardId: card?.id },
      })
      .returning();
    if (charge === undefined) throw new Error('charge insert failed');
    return { booking, charge };
  }

  const deps = () => ({
    db,
    env,
    fetch: forbiddenFetch,
    now: () => NOW,
    registry: createRegistry(),
  });

  it('an approved saved-card charge pays the balance at once', async () => {
    const { booking, charge } = await savedCardCharge('4242');

    const submitted = await submitCharge(deps(), charge.id);

    expect(submitted).toMatchObject({
      status: 'approved',
      approvedAt: NOW,
      externalId: `sbx_${charge.id}`,
    });
    expect(await bookingOf(booking.id)).toMatchObject({
      status: 'paid',
      paidCents: 21900,
      balanceCents: 0,
    });
  });

  it('a declined saved-card charge is rejected and leaves the booking confirmed', async () => {
    const { booking, charge } = await savedCardCharge('0002');

    const submitted = await submitCharge(deps(), charge.id);

    expect(submitted.status).toBe('rejected');
    expect(await bookingOf(booking.id)).toMatchObject({ status: 'confirmed', paidCents: 10950 });
  });
});
