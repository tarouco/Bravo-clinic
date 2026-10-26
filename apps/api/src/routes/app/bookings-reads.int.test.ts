import { randomUUID } from 'node:crypto';
import {
  bookingDetailSchema,
  bookingListSchema,
  policySnapshot,
  settingDefaults,
} from '@bravo/core';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTenant, seededRoom } from '../../../test/booking-helpers';
import { createBooking as insertBooking } from '../../../test/factories';
import { forbiddenFetch, send, testEnv } from '../../../test/http';
import { requireTestDatabaseUrl } from '../../../test/require-test-db';
import { createApp } from '../../app';
import { createDb, withTransaction } from '../../db/client';
import { bookings, refunds, charges } from '../../db/schema';
import { runSeed } from '../../db/seed';
import { saveSetting } from '../../modules/settings/settings.repo';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

const NOW = new Date('2026-10-20T12:00:00.000Z');
const HOUR = 3_600_000;
const at = (hours: number) => new Date(NOW.getTime() + hours * HOUR);

let roomId = '';

beforeEach(async () => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  await runSeed(db);
  roomId = (await seededRoom(db)).id;
});

const app = () => createApp({ db, now: () => NOW, fetch: forbiddenFetch, env: testEnv() });
const get = (path: string, cookie: string) => send(app(), 'GET', path, { cookie });

/** A booking `fromHours` after NOW lasting 2 h; occupancy is skipped so tests may overlap freely. */
const booking = (
  userId: string,
  fromHours: number,
  overrides: Partial<Parameters<typeof insertBooking>[1]> = {},
) =>
  insertBooking(db, {
    userId,
    roomId,
    startsAt: at(fromHours),
    endsAt: at(fromHours + 2),
    occupancy: false,
    ...overrides,
  });

describe('GET /app/bookings?tab (NUC-188)', () => {
  it('splits upcoming, past and cancelled with the documented order and payment statuses', async () => {
    const { user, cookie } = await createTenant(db, { now: NOW });
    const later = await booking(user.id, 96, { totalCents: 20000, paidCents: 10000 });
    const sooner = await booking(user.id, 48, { totalCents: 20000, paidCents: 20000 });
    const holding = await booking(user.id, 72, {
      status: 'awaiting_payment',
      paidCents: 0,
      holdExpiresAt: at(0.25),
    });
    const completed = await booking(user.id, -72, { status: 'completed' });
    const noShow = await booking(user.id, -24, { status: 'no_show' });
    const ended = await booking(user.id, -6, { status: 'confirmed' });
    const expired = await booking(user.id, 30, { status: 'expired', paidCents: 0 });
    const cancelled = await booking(user.id, 120, { status: 'cancelled_by_tenant' });
    const [charge] = await db
      .insert(charges)
      .values({
        provider: 'sandbox',
        purpose: 'booking_deposit',
        method: 'pix',
        userId: user.id,
        bookingId: cancelled.id,
        amountCents: 4850,
        status: 'refunded',
        idempotencyKey: `ch_${randomUUID()}`,
      })
      .returning();
    await db.insert(refunds).values({
      chargeId: charge?.id ?? '',
      bookingId: cancelled.id,
      provider: 'sandbox',
      amountCents: 4850,
      reason: 'tenant_cancel',
      status: 'approved',
    });
    const stranger = await createTenant(db, { now: NOW });
    await booking(stranger.user.id, 50);

    const upcoming = bookingListSchema.parse(
      (await get('/app/bookings?tab=upcoming', cookie)).body,
    );
    const past = bookingListSchema.parse((await get('/app/bookings?tab=past', cookie)).body);
    const gone = bookingListSchema.parse((await get('/app/bookings?tab=cancelled', cookie)).body);

    expect(upcoming.items.map((b) => b.id)).toEqual([sooner.id, holding.id, later.id]);
    expect(past.items.map((b) => b.id)).toEqual([ended.id, noShow.id, completed.id]);
    expect(gone.items.map((b) => b.id)).toEqual([cancelled.id, expired.id]);
    expect(upcoming.items.map((b) => b.paymentStatus)).toEqual([
      { code: 'paid', label: 'Quitada' },
      { code: 'awaiting', label: 'Aguardando pagamento' },
      { code: 'deposit_paid', label: 'Sinal pago · saldo pendente' },
    ]);
    expect(gone.items[0]?.paymentStatus).toEqual({ code: 'refunded', label: 'Reembolsada' });
    expect(upcoming.items[0]).toMatchObject({ group: null, statusLabel: 'Confirmada' });
    expect(upcoming.nextCursor).toBeNull();
  });

  it('paginates with an opaque cursor: 50 rows, then the rest, with no overlap', async () => {
    const { user, cookie } = await createTenant(db, { now: NOW });
    const base = {
      userId: user.id,
      roomId,
      kind: 'single',
      status: 'confirmed',
      source: 'web',
      cleanupMinutes: 30,
      durationMinutes: 60,
      paymentMode: 'deposit_balance',
      policySnapshot: policySnapshot(settingDefaults()),
    };
    await db.insert(bookings).values(
      Array.from({ length: 51 }, (_, i) => ({
        ...base,
        code: `BRV-PAGE${String(i).padStart(2, '0')}`,
        icsUid: `${randomUUID()}@bravoclinic.test`,
        startsAt: at(30 + i),
        endsAt: at(31 + i),
      })),
    );

    const first = bookingListSchema.parse((await get('/app/bookings?tab=upcoming', cookie)).body);
    const second = bookingListSchema.parse(
      (await get(`/app/bookings?tab=upcoming&cursor=${first.nextCursor ?? ''}`, cookie)).body,
    );

    expect(first.items).toHaveLength(50);
    expect(first.nextCursor).not.toBeNull();
    expect(second.items.map((b) => b.code)).toEqual(['BRV-PAGE50']);
    expect(second.nextCursor).toBeNull();
    expect(first.items.map((b) => b.code)[49]).toBe('BRV-PAGE49');
  });

  it('answers 422 for an unknown tab and for a malformed cursor', async () => {
    const { cookie } = await createTenant(db, { now: NOW });

    const tab = await get('/app/bookings?tab=archive', cookie);
    const cursor = await get('/app/bookings?tab=upcoming&cursor=not-a-cursor', cookie);

    expect(tab.status).toBe(422);
    expect(cursor.status).toBe(422);
    expect(cursor.error?.code).toBe('VALIDATION_FAILED');
  });
});

describe('GET /app/bookings/:id (NUC-141)', () => {
  it('answers 404 for a booking of another user', async () => {
    const owner = await createTenant(db, { now: NOW });
    const other = await createTenant(db, { now: NOW });
    const row = await booking(owner.user.id, 48);

    const res = await get(`/app/bookings/${row.id}`, other.cookie);

    expect(res.status).toBe(404);
    expect(res.error?.code).toBe('NOT_FOUND');
  });

  it('blocks reschedule with reason too_late at 23 h and offers the balance payment on a deposit-paid booking', async () => {
    const { user, cookie } = await createTenant(db, { now: NOW });
    const row = await booking(user.id, 23, {
      totalCents: 16000,
      paidCents: 8000,
      depositCents: 8000,
      balanceDueAt: at(22),
    });

    const res = await get(`/app/bookings/${row.id}`, cookie);

    expect(res.status).toBe(200);
    const detail = bookingDetailSchema.parse(res.body);
    expect(detail.actions).toEqual({
      canPay: false,
      canPayBalance: true,
      canReschedule: false,
      rescheduleBlockedReason: 'too_late',
      canCancel: true,
    });
    expect(detail.paymentStatus.code).toBe('deposit_paid');
  });

  it('allows reschedule at 30 h and reports limit_reached once the free reschedule was used', async () => {
    const { user, cookie } = await createTenant(db, { now: NOW });
    const fresh = await booking(user.id, 30);
    const used = await booking(user.id, 40);
    await db.update(bookings).set({ rescheduleCount: 1 }).where(eq(bookings.id, used.id));

    const a = bookingDetailSchema.parse((await get(`/app/bookings/${fresh.id}`, cookie)).body);
    const b = bookingDetailSchema.parse((await get(`/app/bookings/${used.id}`, cookie)).body);

    expect([a.actions.canReschedule, a.actions.rescheduleBlockedReason]).toEqual([true, null]);
    expect([b.actions.canReschedule, b.actions.rescheduleBlockedReason]).toEqual([
      false,
      'limit_reached',
    ]);
  });

  it('renders the policy text from the booking snapshot, not from today’s settings', async () => {
    const { user, cookie } = await createTenant(db, { now: NOW });
    const row = await booking(user.id, 48);
    await withTransaction(db, (tx) => saveSetting(tx, 'payment.deposit_percent', 70, null));

    const detail = bookingDetailSchema.parse((await get(`/app/bookings/${row.id}`, cookie)).body);

    expect(detail.policy.version).toBe(1);
    expect(detail.policy.sections[0]?.title).toBe('Sinal e saldo');
    expect(detail.policy.sections[0]?.paragraphs[0]).toContain('sinal de 50%');
  });
});

describe('GET /app/bookings/:id/ics (NUC-140)', () => {
  it('returns text/calendar whose UID is the booking ics_uid', async () => {
    const { user, cookie } = await createTenant(db, { now: NOW });
    const row = await booking(user.id, 48);

    const response = await app().request(`/app/bookings/${row.id}/ics`, {
      headers: { Cookie: cookie },
    });
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/calendar');
    expect(text).toContain(`UID:${row.icsUid}`);
    expect(text).toContain('METHOD:REQUEST');
    expect(text).toContain(
      `DTSTART:${row.startsAt.toISOString().replace(/[-:]/g, '').replace('.000', '')}`,
    );
  });

  it('answers 404 for another user’s booking', async () => {
    const owner = await createTenant(db, { now: NOW });
    const other = await createTenant(db, { now: NOW });
    const row = await booking(owner.user.id, 48);

    const res = await get(`/app/bookings/${row.id}/ics`, other.cookie);

    expect(res.status).toBe(404);
  });
});
