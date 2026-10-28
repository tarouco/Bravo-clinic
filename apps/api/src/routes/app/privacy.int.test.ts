import { localToUtc } from '@bravo/core';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCharge, createStaff, createTenant, seededRoom } from '../../../test/booking-helpers';
import { createBooking as insertBooking, loginAs } from '../../../test/factories';
import { createFixedCategory, createSubscription } from '../../../test/factories/revenue';
import { forbiddenFetch, send, testEnv } from '../../../test/http';
import { requireTestDatabaseUrl } from '../../../test/require-test-db';
import { createApp } from '../../app';
import { createDb } from '../../db/client';
import {
  auditLog,
  authTokens,
  bookings,
  charges,
  consents,
  emailOutbox,
  extraServices,
  icsFeedTokens,
  pushSubscriptions,
  quoteRequests,
  refunds,
  savedCards,
  sessions,
  userTotp,
  users,
} from '../../db/schema';
import { runSeed } from '../../db/seed';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

// Tuesday 2027-03-02 12:00 BRT.
const NOW = new Date('2027-03-02T15:00:00.000Z');
const PASSWORD = 'senha-forte-123';

beforeEach(async () => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  await runSeed(db);
});

const buildApp = () => createApp({ db, now: () => NOW, fetch: forbiddenFetch, env: testEnv() });
const call = (cookie: string, method: string, path: string, body?: unknown) =>
  send(buildApp(), method, path, { cookie, ...(body !== undefined && { body }) });
const audits = (action: string) => db.select().from(auditLog).where(eq(auditLog.action, action));

/** A tenant with a password, TOTP, a past booking with a refunded charge and personal records. */
async function richTenant() {
  const { user, cookie } = await createTenant(db, {
    now: NOW,
    name: 'Clara Mendes',
    password: PASSWORD,
    totp: true,
    // TOTP on means the session must have passed the second factor (AD-037).
    mfaVerified: true,
  });
  const room = await seededRoom(db);
  const booking = await insertBooking(db, {
    userId: user.id,
    roomId: room.id,
    startsAt: localToUtc('2027-02-09', 840),
    endsAt: localToUtc('2027-02-09', 960),
    status: 'completed',
    occupancy: false,
  });
  const charge = await createCharge(db, {
    userId: user.id,
    bookingId: booking.id,
    purpose: 'booking_full',
    amountCents: 16_000,
    approvedAt: new Date('2027-02-01T12:00:00Z'),
  });
  await db
    .update(charges)
    .set({ rawLast: { secret: 'provider-payload', token_hash: 'x' } })
    .where(eq(charges.id, charge.id));
  await db.insert(refunds).values({
    chargeId: charge.id,
    bookingId: booking.id,
    provider: 'sandbox',
    amountCents: 4000,
    reason: 'manual',
    status: 'approved',
    completedAt: new Date('2027-02-03T12:00:00Z'),
  });
  await db.insert(savedCards).values({
    userId: user.id,
    provider: 'sandbox',
    externalCardId: 'card_tok_123',
    brand: 'visa',
    last4: '4242',
  });
  await db.insert(pushSubscriptions).values({
    userId: user.id,
    endpoint: 'https://push.example.test/send/abc123',
    p256dh: 'key',
    auth: 'auth',
  });
  await db
    .insert(consents)
    .values({ userId: user.id, kind: 'booking_policy', version: 'policy-v1' });
  const [videomaker] = await db
    .select()
    .from(extraServices)
    .where(eq(extraServices.name, 'Videomaker'));
  await db.insert(quoteRequests).values({
    serviceId: videomaker!.id,
    userId: user.id,
    name: 'Clara Mendes',
    email: user.email,
    phone: '+5547999991234',
    description: 'Vídeos para Reels',
  });
  const [mail] = await db
    .insert(emailOutbox)
    .values({
      toAddress: user.email,
      template: 'booking.confirmed',
      subject: 'Reserva confirmada',
      html: '<p>Olá, Clara</p>',
      textBody: 'Olá, Clara',
      status: 'sent',
      sentAt: new Date('2027-02-01T12:05:00Z'),
    })
    .returning();
  return { user, cookie, booking, charge, mail: mail! };
}

/** Every key of a JSON value, at any depth. */
function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, v]) => [key, ...keysOf(v)]);
  }
  return [];
}

describe('GET /app/me/data-export (GES-121..GES-123)', () => {
  it('returns every section as a JSON attachment without secrets, with audit user.data_export', async () => {
    const { user, cookie, booking } = await richTenant();

    const res = await call(cookie, 'GET', '/app/me/data-export');

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toBe(
      'attachment; filename="bravo-meus-dados-2027-03-02.json"',
    );
    const body = res.body as Record<string, unknown[] | Record<string, unknown>>;
    expect(Object.keys(body)).toEqual(
      expect.arrayContaining([
        'profile',
        'consents',
        'bookings',
        'charges',
        'refunds',
        'subscriptions',
        'ledgers',
        'credits',
        'couponUses',
        'quoteRequests',
        'pushSubscriptions',
        'emails',
      ]),
    );
    expect(body['profile']).toMatchObject({ id: user.id, name: 'Clara Mendes', email: user.email });
    expect(body['bookings']).toEqual([expect.objectContaining({ code: booking.code })]);
    expect(body['charges']).toEqual([
      expect.objectContaining({ purpose: 'booking_full', amountCents: 16_000 }),
    ]);
    expect(body['refunds']).toEqual([expect.objectContaining({ amountCents: 4000 })]);
    expect(body['pushSubscriptions']).toEqual([
      { endpointOrigin: 'https://push.example.test', createdAt: expect.any(String) as string },
    ]);
    expect(body['emails']).toEqual([
      { subject: 'Reserva confirmada', sentAt: '2027-02-01T12:05:00.000Z' },
    ]);
    const keys = keysOf(body);
    for (const forbidden of [
      'password_hash',
      'passwordHash',
      'secret',
      'secretCiphertext',
      'recoveryCodeHashes',
      'token_hash',
      'tokenHash',
      'external_card_id',
      'externalCardId',
      'rawLast',
      'externalId',
    ]) {
      expect(keys).not.toContain(forbidden);
    }
    expect(JSON.stringify(body)).not.toContain('card_tok_123');
    const [entry] = await audits('user.data_export');
    expect(entry).toMatchObject({ entityId: user.id, actorUserId: user.id, origin: 'app' });
  });

  it('answers 429 TOO_MANY_ATTEMPTS to the 4th export within 24 hours', async () => {
    const { cookie } = await createTenant(db, { now: NOW });

    const statuses: number[] = [];
    for (let i = 0; i < 4; i++)
      statuses.push((await call(cookie, 'GET', '/app/me/data-export')).status);

    expect(statuses).toEqual([200, 200, 200, 429]);
  });
});

describe('GET /app/me/consents', () => {
  it('lists the session user’s consents newest first', async () => {
    const { user, cookie } = await createTenant(db, { now: NOW });
    await db.insert(consents).values([
      {
        userId: user.id,
        kind: 'terms',
        version: 'terms-2026-10',
        acceptedAt: new Date('2027-01-01T12:00:00Z'),
      },
      {
        userId: user.id,
        kind: 'booking_policy',
        version: 'policy-v1',
        acceptedAt: new Date('2027-02-01T12:00:00Z'),
      },
    ]);

    const res = await call(cookie, 'GET', '/app/me/consents');

    expect(
      (res.body as { items: { kind: string; version: string; acceptedAt: string }[] }).items.map(
        (i) => [i.kind, i.version, i.acceptedAt],
      ),
    ).toEqual([
      ['booking_policy', 'policy-v1', '2027-02-01T12:00:00.000Z'],
      ['terms', 'terms-2026-10', '2027-01-01T12:00:00.000Z'],
    ]);
  });
});

describe('POST /app/me/deletion blockers (GES-125)', () => {
  const deletion = (cookie: string) =>
    call(cookie, 'POST', '/app/me/deletion', { password: PASSWORD });

  async function expectUnchanged(userId: string) {
    const [row] = await db.select().from(users).where(eq(users.id, userId));
    expect([row?.status, row?.deletedAt]).toEqual(['active', null]);
    expect(await audits('user.anonymize')).toHaveLength(0);
  }

  it('answers 409 HAS_ACTIVE_COMMITMENTS with the code of a future booking', async () => {
    const room = await seededRoom(db);
    const { user, cookie } = await createTenant(db, { now: NOW, password: PASSWORD });
    const future = await insertBooking(db, {
      userId: user.id,
      roomId: room.id,
      startsAt: localToUtc('2027-03-09', 840),
      endsAt: localToUtc('2027-03-09', 960),
    });

    const res = await deletion(cookie);

    expect([res.status, res.error?.code, res.error?.details]).toEqual([
      409,
      'HAS_ACTIVE_COMMITMENTS',
      { bookings: [{ code: future.code }], subscriptions: [], charges: [] },
    ]);
    await expectUnchanged(user.id);
  });

  it('answers 409 HAS_ACTIVE_COMMITMENTS with the id of an active subscription', async () => {
    const room = await seededRoom(db);
    const { user, cookie } = await createTenant(db, { now: NOW, password: PASSWORD });
    const { subscription } = await createSubscription(db, {
      userId: user.id,
      category: await createFixedCategory(db),
      roomId: room.id,
      baseOn: '2027-03-01',
    });

    const res = await deletion(cookie);

    expect([res.status, res.error?.code, res.error?.details]).toEqual([
      409,
      'HAS_ACTIVE_COMMITMENTS',
      { bookings: [], subscriptions: [{ id: subscription.id }], charges: [] },
    ]);
    await expectUnchanged(user.id);
  });

  it('answers 409 HAS_ACTIVE_COMMITMENTS with the id of a pending charge', async () => {
    const { user, cookie } = await createTenant(db, { now: NOW, password: PASSWORD });
    const pending = await createCharge(db, {
      userId: user.id,
      bookingId: null,
      purpose: 'extra_hours',
      amountCents: 8000,
      status: 'pending',
    });

    const res = await deletion(cookie);

    expect([res.status, res.error?.code, res.error?.details]).toEqual([
      409,
      'HAS_ACTIVE_COMMITMENTS',
      { bookings: [], subscriptions: [], charges: [{ id: pending.id }] },
    ]);
    await expectUnchanged(user.id);
  });
});

describe('POST /app/me/deletion (GES-124, GES-126)', () => {
  it('answers 401 INVALID_CREDENTIALS to a wrong password, or to a wrong text without a password', async () => {
    const withPassword = await createTenant(db, { now: NOW, password: PASSWORD });
    const googleOnly = await createTenant(db, { now: NOW });

    const wrong = await call(withPassword.cookie, 'POST', '/app/me/deletion', {
      password: 'outra-senha',
    });
    const textInstead = await call(withPassword.cookie, 'POST', '/app/me/deletion', {
      confirmText: 'EXCLUIR',
    });
    const wrongText = await call(googleOnly.cookie, 'POST', '/app/me/deletion', {
      confirmText: 'excluir',
    });

    expect([wrong, textInstead, wrongText].map((r) => [r.status, r.error?.code])).toEqual([
      [401, 'INVALID_CREDENTIALS'],
      [401, 'INVALID_CREDENTIALS'],
      [401, 'INVALID_CREDENTIALS'],
    ]);
    const rows = await db.select({ status: users.status, name: users.name }).from(users);
    expect(rows.every((r) => r.status === 'active')).toBe(true);
    expect(await audits('user.anonymize')).toHaveLength(0);
  });

  it('anonymizes the account, keeps the records, revokes sessions, clears the cookie and confirms by e-mail', async () => {
    const { user, cookie, booking, charge, mail } = await richTenant();
    const feed = (await call(cookie, 'POST', '/app/calendar-feed')).body as { url: string };
    const feedPath = new URL(feed.url).pathname.replace(/^\/api/, '');
    expect((await buildApp().request(feedPath)).status).toBe(200);
    const originalEmail = user.email;

    const res = await call(cookie, 'POST', '/app/me/deletion', { password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie().some((c) => /^bravo_session=;.*Max-Age=0/i.test(c))).toBe(
      true,
    );
    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row).toMatchObject({
      status: 'deleted',
      name: 'Usuário removido',
      email: `deleted-${user.id}@anon.invalid`,
      emailVerifiedAt: null,
      passwordHash: null,
      googleSub: null,
      docType: null,
      docNumber: null,
      phone: null,
      profession: null,
      professionalRegistry: null,
      notes: null,
      deletedAt: NOW,
    });
    // Fiscal and legal records stay.
    expect(await db.select().from(bookings).where(eq(bookings.id, booking.id))).toHaveLength(1);
    expect(await db.select().from(charges).where(eq(charges.id, charge.id))).toHaveLength(1);
    expect(await db.select().from(consents).where(eq(consents.userId, user.id))).toHaveLength(1);
    expect(await db.select().from(userTotp).where(eq(userTotp.userId, user.id))).toEqual([]);
    expect(
      await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, user.id)),
    ).toEqual([]);
    expect(await db.select().from(authTokens).where(eq(authTokens.userId, user.id))).toEqual([]);
    const [card] = await db.select().from(savedCards).where(eq(savedCards.userId, user.id));
    expect(card?.deletedAt).toEqual(NOW);
    const [quote] = await db.select().from(quoteRequests).where(eq(quoteRequests.userId, user.id));
    expect(quote).toMatchObject({ name: 'Removido', email: null, phone: 'removido' });
    const open = await db.select().from(sessions).where(eq(sessions.userId, user.id));
    expect(open.every((s) => s.revokedAt !== null)).toBe(true);
    expect((await call(cookie, 'GET', '/app/me')).status).toBe(401);
    // The confirmation goes to the original address; older e-mails are rewritten.
    const outbox = await db.select().from(emailOutbox);
    const confirmation = outbox.find((m) => m.template === 'privacy.account_deleted');
    expect(confirmation?.toAddress).toBe(originalEmail);
    expect(confirmation?.subject).toBe('Sua conta na Bravô Clinic foi excluída');
    const older = outbox.find((m) => m.id === mail.id);
    expect(older).toMatchObject({
      toAddress: `deleted-${user.id}@anon.invalid`,
      html: '',
      textBody: '',
      attachments: [],
    });
    const [feedRow] = await db
      .select()
      .from(icsFeedTokens)
      .where(eq(icsFeedTokens.userId, user.id));
    expect(feedRow?.revokedAt).not.toBeNull();
    expect((await buildApp().request(feedPath)).status).toBe(404);
    const [entry] = await audits('user.anonymize');
    expect(entry).toMatchObject({ entityId: user.id, actorUserId: user.id, origin: 'app' });
  });

  it('accepts EXCLUIR for an account without a password', async () => {
    const googleOnly = await createTenant(db, { now: NOW });

    const res = await call(googleOnly.cookie, 'POST', '/app/me/deletion', {
      confirmText: 'EXCLUIR',
    });

    expect(res.status).toBe(200);
    const [row] = await db.select().from(users).where(eq(users.id, googleOnly.user.id));
    expect(row?.status).toBe('deleted');
  });
});

describe('POST /admin/customers/:id/anonymize (GES-127)', () => {
  it('requires a justification, is admin only and applies the same effects with audit', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const reception = await createStaff(db, 'reception', NOW);
    const { user } = await createTenant(db, { now: NOW, password: PASSWORD });
    const tenantCookie = await loginAs(db, user, { now: NOW });

    const noReason = await call(admin.cookie, 'POST', `/admin/customers/${user.id}/anonymize`, {
      justification: 'oi',
    });
    const byReception = await call(
      reception.cookie,
      'POST',
      `/admin/customers/${user.id}/anonymize`,
      { justification: 'Pedido por e-mail em 01/03' },
    );
    const done = await call(admin.cookie, 'POST', `/admin/customers/${user.id}/anonymize`, {
      justification: 'Pedido por e-mail em 01/03',
    });

    expect([noReason.status, noReason.error?.details?.[0]?.path]).toEqual([422, 'justification']);
    expect([byReception.status, byReception.error?.code]).toEqual([403, 'FORBIDDEN']);
    expect(done.status).toBe(200);
    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row).toMatchObject({ status: 'deleted', email: `deleted-${user.id}@anon.invalid` });
    expect((await call(tenantCookie, 'GET', '/app/me')).status).toBe(401);
    const [entry] = await audits('user.anonymize');
    expect(entry).toMatchObject({
      entityId: user.id,
      actorUserId: admin.user.id,
      justification: 'Pedido por e-mail em 01/03',
    });
  });

  it('answers 409 HAS_ACTIVE_COMMITMENTS when the customer still has a future booking', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const { user } = await createTenant(db, { now: NOW });
    const room = await seededRoom(db);
    const future = await insertBooking(db, {
      userId: user.id,
      roomId: room.id,
      startsAt: localToUtc('2027-03-09', 840),
      endsAt: localToUtc('2027-03-09', 960),
    });

    const res = await call(admin.cookie, 'POST', `/admin/customers/${user.id}/anonymize`, {
      justification: 'Pedido por e-mail em 01/03',
    });

    expect([res.status, res.error?.code]).toEqual([409, 'HAS_ACTIVE_COMMITMENTS']);
    expect((res.error?.details as unknown as { bookings: unknown[] }).bookings).toEqual([
      { code: future.code },
    ]);
  });
});
