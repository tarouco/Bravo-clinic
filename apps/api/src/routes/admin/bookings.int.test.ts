import {
  bookingDetailSchema,
  localToUtc,
  preReservationPublicSchema,
  staffBookingCreatedSchema,
  type LocalDate,
} from '@bravo/core';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCharge, createStaff, createTenant, seededRoom } from '../../../test/booking-helpers';
import { createBooking as insertBooking } from '../../../test/factories';
import { forbiddenFetch, send, testEnv } from '../../../test/http';
import { requireTestDatabaseUrl } from '../../../test/require-test-db';
import { createApp } from '../../app';
import { createDb } from '../../db/client';
import { auditLog, bookings, charges, emailOutbox } from '../../db/schema';
import { runSeed } from '../../db/seed';
import { sha256Hex } from '../../lib/crypto';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

const NOW = new Date('2026-10-20T12:00:00.000Z');
const MINUTE = 60_000;
const TUE = '2026-10-27' as LocalDate;

let roomId = '';

beforeEach(async () => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  await runSeed(db);
  roomId = (await seededRoom(db)).id;
});

const buildApp = () => createApp({ db, now: () => NOW, fetch: forbiddenFetch, env: testEnv() });
const call = (method: string, path: string, cookie: string, body?: unknown) =>
  send(buildApp(), method, path, { cookie, ...(body !== undefined && { body }) });

const slot = { date: TUE, startMinute: 840, endMinute: 900 };
const createBody = (userId: string, extra: Record<string, unknown> = {}) => ({
  userId,
  roomId,
  ...slot,
  kind: 'booking',
  ...extra,
});

const tokenOf = (link: string) => link.split('/pre-reserva/')[1] ?? '';
const audits = async (action: string) =>
  (await db.select().from(auditLog)).filter((row) => row.action === action);

describe('POST /admin/bookings (NUC-161..NUC-163)', () => {
  it('lets reception create an awaiting_payment booking with the 15 min hold and a payment link by e-mail', async () => {
    const reception = await createStaff(db, 'reception', NOW);
    const { user } = await createTenant(db, { now: NOW });

    const res = await call('POST', '/admin/bookings', reception.cookie, createBody(user.id));

    expect(res.status).toBe(201);
    const created = staffBookingCreatedSchema.parse(res.body);
    expect(created).toMatchObject({
      status: 'awaiting_payment',
      holdExpiresAt: '2026-10-20T12:15:00.000Z',
      source: 'admin',
      totalCents: 9700,
    });
    const link = created.paymentLink ?? '';
    expect(link).toMatch(/\/pre-reserva\/[A-Za-z0-9_-]+$/);
    const [row] = await db.select().from(bookings).where(eq(bookings.id, created.id));
    expect(row).toMatchObject({
      userId: user.id,
      createdByUserId: reception.user.id,
      paymentLinkTokenHash: sha256Hex(tokenOf(link)),
    });
    const mails = await db.select().from(emailOutbox);
    expect(mails.map((m) => m.template)).toEqual(['booking.pre_reservation_link']);
    expect(mails[0]?.textBody).toContain(link);
    expect((await audits('booking.create'))[0]).toMatchObject({
      entityId: created.id,
      actorUserId: reception.user.id,
    });
  });

  it('creates a pre_reserved booking holding 24 h by default and 48 h when asked', async () => {
    const reception = await createStaff(db, 'reception', NOW);
    const { user } = await createTenant(db, { now: NOW });

    const byDefault = await call(
      'POST',
      '/admin/bookings',
      reception.cookie,
      createBody(user.id, { kind: 'pre_reservation' }),
    );
    const longer = await call(
      'POST',
      '/admin/bookings',
      reception.cookie,
      createBody(user.id, {
        kind: 'pre_reservation',
        expiresInHours: 48,
        startMinute: 1020,
        endMinute: 1080,
      }),
    );

    expect(byDefault.status).toBe(201);
    expect(staffBookingCreatedSchema.parse(byDefault.body)).toMatchObject({
      status: 'pre_reserved',
      holdExpiresAt: '2026-10-21T12:00:00.000Z',
    });
    expect(staffBookingCreatedSchema.parse(longer.body)).toMatchObject({
      status: 'pre_reserved',
      holdExpiresAt: '2026-10-22T12:00:00.000Z',
    });
  });

  it('answers 403 when reception asks for a manual confirmation and creates nothing', async () => {
    const reception = await createStaff(db, 'reception', NOW);
    const { user } = await createTenant(db, { now: NOW });

    const res = await call(
      'POST',
      '/admin/bookings',
      reception.cookie,
      createBody(user.id, { confirmManually: true, justification: 'Pagou no balcão' }),
    );

    expect(res.status).toBe(403);
    expect(res.error?.code).toBe('FORBIDDEN');
    expect(await db.select().from(bookings)).toHaveLength(0);
  });

  it('lets an admin confirm manually at creation: manual mode, audit, no balance schedule', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const { user } = await createTenant(db, { now: NOW });

    const res = await call(
      'POST',
      '/admin/bookings',
      admin.cookie,
      createBody(user.id, { confirmManually: true, justification: 'Pagou no balcão' }),
    );

    expect(res.status).toBe(201);
    const created = staffBookingCreatedSchema.parse(res.body);
    expect(created).toMatchObject({
      status: 'confirmed',
      paymentMode: 'manual',
      holdExpiresAt: null,
      paymentLink: null,
      paidCents: 0,
      balanceCents: 9700,
    });
    const [row] = await db.select().from(bookings).where(eq(bookings.id, created.id));
    expect(row).toMatchObject({
      confirmedManuallyBy: admin.user.id,
      balanceChargeAt: null,
      balanceDueAt: null,
    });
    expect((await audits('booking.confirm_manual'))[0]).toMatchObject({
      entityId: created.id,
      justification: 'Pagou no balcão',
    });
    expect((await db.select().from(emailOutbox)).map((m) => m.template)).toEqual([
      'booking.confirmed',
    ]);
  });

  it('answers 409 SLOT_TAKEN for an occupied slot and 422 for a customer who is not a tenant', async () => {
    const reception = await createStaff(db, 'reception', NOW);
    const { user } = await createTenant(db, { now: NOW });
    await insertBooking(db, {
      userId: user.id,
      roomId,
      startsAt: localToUtc(TUE, 840),
      endsAt: localToUtc(TUE, 900),
    });

    const taken = await call('POST', '/admin/bookings', reception.cookie, createBody(user.id));
    const notTenant = await call(
      'POST',
      '/admin/bookings',
      reception.cookie,
      createBody(reception.user.id, { startMinute: 1200, endMinute: 1260 }),
    );

    expect(taken.status).toBe(409);
    expect(taken.error?.code).toBe('SLOT_TAKEN');
    expect(notTenant.status).toBe(422);
  });
});

describe('POST /admin/bookings/:id/confirm-manual (NUC-163)', () => {
  it('confirms a pre-reservation for an admin, cancelling its pending charge; 403 for reception', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const reception = await createStaff(db, 'reception', NOW);
    const { user } = await createTenant(db, { now: NOW });
    const row = await insertBooking(db, {
      userId: user.id,
      roomId,
      startsAt: localToUtc(TUE, 840),
      endsAt: localToUtc(TUE, 900),
      status: 'pre_reserved',
      paidCents: 0,
      holdExpiresAt: new Date(NOW.getTime() + 3_600_000),
    });
    const pending = await createCharge(db, {
      userId: user.id,
      bookingId: row.id,
      purpose: 'booking_deposit',
      amountCents: 4850,
      status: 'pending',
    });
    const path = `/admin/bookings/${row.id}/confirm-manual`;
    const body = { justification: 'Pago por transferência' };

    const forbidden = await call('POST', path, reception.cookie, body);
    const res = await call('POST', path, admin.cookie, body);

    expect(forbidden.status).toBe(403);
    expect(res.status).toBe(200);
    expect(bookingDetailSchema.parse(res.body)).toMatchObject({
      status: 'confirmed',
      paymentMode: 'manual',
      holdExpiresAt: null,
    });
    const [stored] = await db.select().from(bookings).where(eq(bookings.id, row.id));
    expect(stored).toMatchObject({
      confirmedManuallyBy: admin.user.id,
      balanceChargeAt: null,
      balanceDueAt: null,
    });
    expect((await db.select().from(charges).where(eq(charges.id, pending.id)))[0]?.status).toBe(
      'cancelled',
    );
    expect((await audits('booking.confirm_manual'))[0]).toMatchObject({
      justification: 'Pago por transferência',
    });
  });

  it('answers 409 for a booking that is not waiting for payment', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const { user } = await createTenant(db, { now: NOW });
    const row = await insertBooking(db, {
      userId: user.id,
      roomId,
      startsAt: localToUtc(TUE, 840),
      endsAt: localToUtc(TUE, 900),
    });

    const res = await call('POST', `/admin/bookings/${row.id}/confirm-manual`, admin.cookie, {
      justification: 'Pago por transferência',
    });

    expect(res.status).toBe(409);
  });
});

describe('payment links (NUC-164, NUC-165)', () => {
  const createdBy = async (kind: 'booking' | 'pre_reservation') => {
    const reception = await createStaff(db, 'reception', NOW);
    const { user } = await createTenant(db, { name: 'Marina Costa', now: NOW });
    const res = await call(
      'POST',
      '/admin/bookings',
      reception.cookie,
      createBody(user.id, { kind }),
    );
    const created = staffBookingCreatedSchema.parse(res.body);
    return { reception, created, token: tokenOf(created.paymentLink ?? '') };
  };
  const resolve = (token: string) => send(buildApp(), 'GET', `/public/pre-reservations/${token}`);

  it('resolves the token to the booking summary with the customer’s first name', async () => {
    const { created, token } = await createdBy('pre_reservation');

    const res = await resolve(token);

    expect(res.status).toBe(200);
    expect(preReservationPublicSchema.parse(res.body)).toEqual({
      bookingId: created.id,
      code: created.code,
      roomName: 'Sala Principal',
      startsAt: created.startsAt,
      endsAt: created.endsAt,
      totalCents: 9700,
      holdExpiresAt: '2026-10-21T12:00:00.000Z',
      customerFirstName: 'Marina',
    });
  });

  it('rotates the token on resend: the old link is 404, the new one resolves, and a new e-mail goes out', async () => {
    const { reception, created, token } = await createdBy('pre_reservation');

    const resend = await call(
      'POST',
      `/admin/bookings/${created.id}/resend-link`,
      reception.cookie,
    );

    expect(resend.status).toBe(200);
    const fresh = (resend.body as { paymentLink: string }).paymentLink;
    expect(tokenOf(fresh)).not.toBe(token);
    expect((await resolve(token)).status).toBe(404);
    expect((await resolve(tokenOf(fresh))).status).toBe(200);
    const mails = await db.select().from(emailOutbox);
    expect(mails.map((m) => m.template)).toEqual([
      'booking.pre_reservation_link',
      'booking.pre_reservation_link',
    ]);
    expect(mails.at(-1)?.textBody).toContain(fresh);
  });

  it('answers 404 for an unknown token and for a link whose hold ran out', async () => {
    const { created, token } = await createdBy('booking');
    await db
      .update(bookings)
      .set({ holdExpiresAt: new Date(NOW.getTime() - MINUTE) })
      .where(eq(bookings.id, created.id));

    expect((await resolve(token)).status).toBe(404);
    expect((await resolve('not-a-token')).status).toBe(404);
  });
});

describe('POST /admin/bookings/:id/check-in (NUC-167)', () => {
  const startingIn = async (minutes: number, durationMinutes = 60) => {
    const { user } = await createTenant(db, { now: NOW });
    return insertBooking(db, {
      userId: user.id,
      roomId,
      startsAt: new Date(NOW.getTime() + minutes * MINUTE),
      endsAt: new Date(NOW.getTime() + (minutes + durationMinutes) * MINUTE),
      // These bookings overlap in time; check-in never reads the occupancy.
      occupancy: false,
    });
  };

  it('refuses 61 min before the start with the window message, accepts 30 min before and audits it', async () => {
    const reception = await createStaff(db, 'reception', NOW);
    const early = await startingIn(61);
    const open = await startingIn(30);

    const refused = await call('POST', `/admin/bookings/${early.id}/check-in`, reception.cookie);
    const accepted = await call('POST', `/admin/bookings/${open.id}/check-in`, reception.cookie);

    expect(refused.status).toBe(409);
    expect(refused.error?.code).toBe('INVALID_STATE');
    expect(refused.error?.message).toBe('Check-in disponível de 1h antes até o fim da reserva.');
    expect(accepted.status).toBe(200);
    expect(bookingDetailSchema.parse(accepted.body).checkedInAt).toBe(NOW.toISOString());
    const [stored] = await db.select().from(bookings).where(eq(bookings.id, open.id));
    expect(stored?.checkedInAt?.toISOString()).toBe(NOW.toISOString());
    expect(
      (await db.select().from(bookings).where(eq(bookings.id, early.id)))[0]?.checkedInAt,
    ).toBeNull();
    expect((await audits('booking.check_in'))[0]).toMatchObject({
      entityId: open.id,
      actorUserId: reception.user.id,
    });
  });

  it('refuses after the booking ended', async () => {
    const reception = await createStaff(db, 'reception', NOW);
    const ended = await startingIn(-180);

    const res = await call('POST', `/admin/bookings/${ended.id}/check-in`, reception.cookie);

    expect(res.status).toBe(409);
  });
});

describe('PATCH /admin/bookings/:id/cleanup (NUC-39)', () => {
  const body = { cleanupMinutes: 0, justification: 'Sala usada só para consulta' };
  const upper = async (id: string) => {
    const { rows } = await pool.query<{ until: Date }>(
      `select upper(period) as until from room_occupancy where ref_id = $1 and active`,
      [id],
    );
    return rows.map((r) => r.until.toISOString());
  };

  it('sets cleanup 0 for an admin: occupancy ends with the booking, the booking is marked overridden', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const { user } = await createTenant(db, { now: NOW });
    const row = await insertBooking(db, {
      userId: user.id,
      roomId,
      startsAt: localToUtc(TUE, 840),
      endsAt: localToUtc(TUE, 900),
    });

    const res = await call('PATCH', `/admin/bookings/${row.id}/cleanup`, admin.cookie, body);

    expect(res.status).toBe(200);
    expect(bookingDetailSchema.parse(res.body).cleanupMinutes).toBe(0);
    expect(await upper(row.id)).toEqual([localToUtc(TUE, 900).toISOString()]);
    const [stored] = await db.select().from(bookings).where(eq(bookings.id, row.id));
    expect(stored).toMatchObject({ cleanupMinutes: 0, cleanupOverriddenBy: admin.user.id });
    expect(stored?.cleanupOverriddenAt).not.toBeNull();
    expect((await audits('booking.cleanup_exception'))[0]).toMatchObject({
      entityId: row.id,
      justification: 'Sala usada só para consulta',
      before: { cleanupMinutes: 30 },
      after: { cleanupMinutes: 0 },
    });
  });

  it('answers 422 without a justification and 403 to reception', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const reception = await createStaff(db, 'reception', NOW);
    const { user } = await createTenant(db, { now: NOW });
    const row = await insertBooking(db, {
      userId: user.id,
      roomId,
      startsAt: localToUtc(TUE, 840),
      endsAt: localToUtc(TUE, 900),
    });
    const path = `/admin/bookings/${row.id}/cleanup`;

    const unjustified = await call('PATCH', path, admin.cookie, { cleanupMinutes: 0 });
    const forbidden = await call('PATCH', path, reception.cookie, body);

    expect(unjustified.status).toBe(422);
    expect(forbidden.status).toBe(403);
    expect(await upper(row.id)).toEqual([localToUtc(TUE, 930).toISOString()]);
  });

  it('answers 409 SLOT_TAKEN when a longer cleanup would run into the next booking', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const { user } = await createTenant(db, { now: NOW });
    const first = await insertBooking(db, {
      userId: user.id,
      roomId,
      startsAt: localToUtc(TUE, 840),
      endsAt: localToUtc(TUE, 900),
    });
    await insertBooking(db, {
      userId: user.id,
      roomId,
      startsAt: localToUtc(TUE, 930),
      endsAt: localToUtc(TUE, 990),
    });

    const res = await call('PATCH', `/admin/bookings/${first.id}/cleanup`, admin.cookie, {
      cleanupMinutes: 60,
      justification: 'Higienização completa',
    });

    expect(res.status).toBe(409);
    expect(res.error?.code).toBe('SLOT_TAKEN');
    expect(await upper(first.id)).toEqual([localToUtc(TUE, 930).toISOString()]);
  });
});
