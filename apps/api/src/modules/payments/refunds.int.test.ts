import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createBooking, createUser } from '../../../test/factories';
import { forbiddenFetch, testEnv } from '../../../test/http';
import { requireTestDatabaseUrl } from '../../../test/require-test-db';
import { createDb, withTransaction } from '../../db/client';
import { bookings, charges, integrationSettings, refunds, rooms } from '../../db/schema';
import { runSeed } from '../../db/seed';
import { getEnv } from '../../env';
import { createRegistry, type StaffEvent } from '../../extensions/registry';
import { encryptSecret } from '../../lib/crypto';
import type { RequestContext } from '../../lib/audit';
import type { PaymentDeps } from './charges.service';
import { processPendingRefunds, processRefund, requestRefund } from './refunds.service';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

const NOW = new Date('2026-10-20T12:00:00.000Z');
const ctx: RequestContext = {
  actorUserId: null,
  actorRole: 'admin',
  origin: 'admin',
  ip: null,
  requestId: null,
};

let roomId = '';

beforeEach(async () => {
  await runSeed(db);
  const [room] = await db.select().from(rooms).limit(1);
  roomId = room?.id ?? '';
});

function depsWith(overrides: Partial<PaymentDeps> = {}) {
  const staff: { event: StaffEvent; entityId: string }[] = [];
  const registry = createRegistry({
    notifications: {
      notifyStaff: (event, payload) => {
        staff.push({ event, entityId: payload.entityId });
        return Promise.resolve();
      },
    },
  });
  const deps: PaymentDeps = {
    db,
    env: testEnv(),
    fetch: forbiddenFetch,
    now: () => NOW,
    registry,
    ...overrides,
  };
  return { deps, staff };
}

/** A confirmed booking paid 109,50 by an approved sandbox charge. */
async function paidBooking(provider: 'sandbox' | 'mercadopago' = 'sandbox') {
  const user = await createUser(db, { email: 'ana@bravoclinic.test' });
  const booking = await createBooking(db, {
    userId: user.id,
    roomId,
    startsAt: new Date('2026-10-27T13:00:00.000Z'),
    endsAt: new Date('2026-10-27T15:00:00.000Z'),
    totalCents: 21900,
    depositCents: 10950,
    paidCents: 10950,
  });
  const id = randomUUID();
  const [charge] = await db
    .insert(charges)
    .values({
      id,
      provider,
      externalId: provider === 'sandbox' ? `sbx_${id}` : '123456789',
      purpose: 'booking_deposit',
      method: 'pix',
      userId: user.id,
      bookingId: booking.id,
      amountCents: 10950,
      status: 'approved',
      approvedAt: NOW,
      idempotencyKey: `ch_${id}`,
    })
    .returning();
  if (charge === undefined) throw new Error('charge insert failed');
  return { user, booking, charge };
}

const request = (
  chargeId: string,
  amountCents: number,
  reason: 'tenant_cancel' | 'manual' = 'tenant_cancel',
) => withTransaction(db, (tx) => requestRefund(tx, { chargeId, amountCents, reason, ctx }));

const chargeOf = async (id: string) => {
  const [row] = await db.select().from(charges).where(eq(charges.id, id));
  if (row === undefined) throw new Error('charge missing');
  return row;
};

describe('requestRefund (NUC-119)', () => {
  it('writes a pending refund row tied to the charge and booking', async () => {
    const { charge, booking } = await paidBooking();

    const refund = await request(charge.id, 4850);

    expect(refund).toMatchObject({
      chargeId: charge.id,
      bookingId: booking.id,
      provider: 'sandbox',
      amountCents: 4850,
      reason: 'tenant_cancel',
      status: 'pending',
      attempts: 0,
      lastError: null,
      completedAt: null,
    });
  });

  it('rejects more than what is left to refund, counting pending refunds', async () => {
    const { charge } = await paidBooking();
    await request(charge.id, 10000);

    await expect(request(charge.id, 951)).rejects.toMatchObject({
      status: 422,
      code: 'VALIDATION_FAILED',
    });
    await expect(request(charge.id, 950)).resolves.toMatchObject({ amountCents: 950 });
  });

  it('rejects a charge that was never approved', async () => {
    const { charge } = await paidBooking();
    await db.update(charges).set({ status: 'pending' }).where(eq(charges.id, charge.id));

    await expect(request(charge.id, 100)).rejects.toMatchObject({ status: 409 });
  });
});

describe('processRefund success (NUC-119)', () => {
  it('approves the refund with completed_at and moves the charge to partially_refunded, then refunded', async () => {
    const { charge, booking } = await paidBooking();
    const { deps } = depsWith();
    const first = await request(charge.id, 4850);

    const done = await processRefund(deps, first.id);

    expect(done).toMatchObject({
      status: 'approved',
      completedAt: NOW,
      attempts: 1,
      lastError: null,
    });
    expect(done.externalId).toBe(`sbx_refund_refund:${first.id}`);
    expect(await chargeOf(charge.id)).toMatchObject({
      status: 'partially_refunded',
      refundedCents: 4850,
    });
    const [after] = await db.select().from(bookings).where(eq(bookings.id, booking.id));
    expect(after?.paidCents).toBe(6100);

    const second = await request(charge.id, 6100);
    await processRefund(deps, second.id);
    expect(await chargeOf(charge.id)).toMatchObject({ status: 'refunded', refundedCents: 10950 });
  });

  it('does nothing for a refund that is not pending', async () => {
    const { charge } = await paidBooking();
    const { deps } = depsWith();
    const refund = await request(charge.id, 1000);
    await processRefund(deps, refund.id);

    const again = await processRefund(deps, refund.id);

    expect(again.status).toBe('approved');
    expect((await chargeOf(charge.id)).refundedCents).toBe(1000);
  });
});

describe('processRefund failures (NUC-119)', () => {
  async function useMercadoPago() {
    await db.insert(integrationSettings).values({
      key: 'gateway.mercadopago',
      environment: 'test',
      secretCiphertext: encryptSecret(
        JSON.stringify({ accessToken: 'APP_USR-x' }),
        getEnv().ENCRYPTION_KEY,
      ),
    });
  }
  const failing: typeof fetch = () => Promise.reject(new TypeError('connect ECONNRESET'));

  it('keeps the refund pending with attempts = 1 and last_error when the gateway fails', async () => {
    const { charge } = await paidBooking('mercadopago');
    await useMercadoPago();
    const { deps } = depsWith({ fetch: failing });
    const refund = await request(charge.id, 4850);

    const result = await processRefund(deps, refund.id);

    expect(result).toMatchObject({ status: 'pending', attempts: 1, completedAt: null });
    expect(result.lastError).toBe('Falha de rede ao chamar o Mercado Pago');
    expect(await chargeOf(charge.id)).toMatchObject({ status: 'approved', refundedCents: 0 });
  });

  it('turns the refund failed and notifies payment_issue after the fifth failed attempt', async () => {
    const { charge } = await paidBooking('mercadopago');
    await useMercadoPago();
    const { deps, staff } = depsWith({ fetch: failing });
    const refund = await request(charge.id, 4850);

    const rounds = [];
    for (let i = 0; i < 6; i++) rounds.push(await processPendingRefunds(deps));

    const [row] = await db.select().from(refunds).where(eq(refunds.id, refund.id));
    expect(row).toMatchObject({ status: 'failed', attempts: 5 });
    expect(rounds.map((r) => r.processed)).toEqual([1, 1, 1, 1, 1, 0]);
    expect(rounds[4]?.failed).toBe(1);
    expect(staff).toEqual([{ event: 'payment_issue', entityId: refund.id }]);
  });

  it('retries a pending refund on the next run and approves it once the gateway answers', async () => {
    const { charge } = await paidBooking('mercadopago');
    await useMercadoPago();
    const refund = await request(charge.id, 4850);
    await processRefund(depsWith({ fetch: failing }).deps, refund.id);
    const working: typeof fetch = () =>
      Promise.resolve(
        new Response(JSON.stringify({ id: 777, status: 'approved' }), { status: 201 }),
      );

    const stats = await processPendingRefunds(depsWith({ fetch: working }).deps);

    expect(stats).toEqual({ processed: 1, approved: 1, failed: 0 });
    const [row] = await db.select().from(refunds).where(eq(refunds.id, refund.id));
    expect(row).toMatchObject({
      status: 'approved',
      externalId: '777',
      lastError: null,
      attempts: 2,
    });
    expect(await chargeOf(charge.id)).toMatchObject({ status: 'partially_refunded' });
  });
});
