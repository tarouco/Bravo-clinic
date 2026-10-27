import { randomUUID } from 'node:crypto';
import { localToUtc, type LocalDate } from '@bravo/core';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStaff, createTenant, seededRoom } from '../../../test/booking-helpers';
import { createBooking as insertBooking } from '../../../test/factories';
import {
  createCoupon,
  createCouponUse,
  createCreditLot,
  createExtraLot,
  createHourPackageCategory,
  createSubscription,
} from '../../../test/factories/revenue';
import { forbiddenFetch, send, testEnv } from '../../../test/http';
import { connectMcp } from '../../../test/mcp-client';
import { requireTestDatabaseUrl } from '../../../test/require-test-db';
import { createApp } from '../../app';
import { createDb, withTransaction } from '../../db/client';
import { auditLog, consents, extraServices, quoteRequests, users } from '../../db/schema';
import { runSeed } from '../../db/seed';
import { saveSetting } from '../../modules/settings/settings.repo';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

const NOW = new Date('2027-03-02T15:00:00.000Z');

beforeEach(async () => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  await runSeed(db);
});

const buildApp = () => createApp({ db, now: () => NOW, fetch: forbiddenFetch, env: testEnv() });
const call = (cookie: string, method: string, path: string, body?: unknown) =>
  send(buildApp(), method, path, { cookie, ...(body !== undefined && { body }) });

const audits = (action: string) => db.select().from(auditLog).where(eq(auditLog.action, action));
const names = (res: { body: unknown }) =>
  (res.body as { items: { name: string }[] }).items.map((i) => i.name);

async function tenant(values: Partial<typeof users.$inferInsert>) {
  const [row] = await db
    .insert(users)
    .values({ name: 'Cliente', email: `c-${randomUUID()}@bravoclinic.test`, ...values })
    .returning();
  return row!;
}

describe('GET /admin/customers (GES-99)', () => {
  it('finds tenants by name, e-mail, document digits and phone digits', async () => {
    const reception = await createStaff(db, 'reception', NOW);
    await tenant({
      name: 'Mariana Duarte',
      email: 'mari.duarte@clinic.test',
      docType: 'cpf',
      docNumber: '52998224725',
      phone: '+5547991234567',
    });
    await tenant({ name: 'Rafael Costa', phone: '+5548988887777' });

    const byName = await call(reception.cookie, 'GET', '/admin/customers?q=mariana');
    const byEmail = await call(reception.cookie, 'GET', '/admin/customers?q=MARI.DUARTE');
    const byDoc = await call(reception.cookie, 'GET', '/admin/customers?q=529.982');
    const byPhone = await call(reception.cookie, 'GET', '/admin/customers?q=(47)%2099123');

    for (const res of [byName, byEmail, byDoc, byPhone]) {
      expect(res.status).toBe(200);
      expect(names(res)).toEqual(['Mariana Duarte']);
    }
    expect((byName.body as { items: unknown[] }).items[0]).toEqual({
      id: expect.any(String) as string,
      name: 'Mariana Duarte',
      email: 'mari.duarte@clinic.test',
      phone: '+5547991234567',
      docMasked: '***.***.***-25',
    });
  });

  it('excludes staff and deleted users and pages 50 at a time with a cursor', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    await tenant({ name: 'Paciente Removido', status: 'deleted' });
    const base = new Date('2027-01-01T12:00:00Z').getTime();
    await db.insert(users).values(
      Array.from({ length: 51 }, (_, i) => ({
        name: `Paciente ${String(i + 1).padStart(2, '0')}`,
        email: `p${String(i)}-${randomUUID()}@bravoclinic.test`,
        createdAt: new Date(base + i * 60_000),
      })),
    );

    const first = await call(admin.cookie, 'GET', '/admin/customers?q=');
    const cursor = (first.body as { nextCursor: string }).nextCursor;
    const second = await call(admin.cookie, 'GET', `/admin/customers?cursor=${cursor}`);
    const staffSearch = await call(admin.cookie, 'GET', '/admin/customers?q=Equipe');
    const deletedSearch = await call(admin.cookie, 'GET', '/admin/customers?q=Removido');

    expect(names(first)).toHaveLength(50);
    expect(names(first)[0]).toBe('Paciente 51');
    expect(names(second)).toEqual(['Paciente 01']);
    expect((second.body as { nextCursor: null }).nextCursor).toBeNull();
    expect([names(staffSearch), names(deletedSearch)]).toEqual([[], []]);
  });
});

describe('GET /admin/customers/:id (GES-100)', () => {
  it('returns the profile and every section from factory data', async () => {
    const reception = await createStaff(db, 'reception', NOW);
    const { user } = await createTenant(db, { now: NOW, name: 'Clara Mendes' });
    const room = await seededRoom(db);
    const booking = await insertBooking(db, {
      userId: user.id,
      roomId: room.id,
      startsAt: localToUtc('2027-03-09', 840),
      endsAt: localToUtc('2027-03-09', 960),
      totalCents: 16_000,
    });
    const category = await createHourPackageCategory(db, { name: 'Pacote 20h mensal' });
    const { subscription } = await createSubscription(db, {
      userId: user.id,
      category,
      baseOn: '2027-02-15',
      period: { minutesBalance: 600 },
    });
    const lot = await createExtraLot(db, {
      userId: user.id,
      minutes: 120,
      expiresAt: new Date('2027-05-01T03:00:00Z'),
    });
    await createExtraLot(db, { userId: user.id, expiresAt: new Date('2027-01-01T03:00:00Z') });
    const credit = await createCreditLot(db, {
      userId: user.id,
      amountCents: 3000,
      expiresAt: new Date('2027-05-01T03:00:00Z'),
    });
    const coupon = await createCoupon(db, { code: 'BEMVINDO' });
    const use = await createCouponUse(db, {
      couponId: coupon.id,
      userId: user.id,
      status: 'consumed',
      bookingId: booking.id,
      discountCents: 1600,
    });
    const [consent] = await db
      .insert(consents)
      .values({ userId: user.id, kind: 'booking_policy', version: '1' })
      .returning();
    const [videomaker] = await db
      .select()
      .from(extraServices)
      .where(eq(extraServices.name, 'Videomaker'));
    const [quote] = await db
      .insert(quoteRequests)
      .values({
        serviceId: videomaker!.id,
        userId: user.id,
        name: 'Clara Mendes',
        phone: '+5547999991234',
        description: 'Vídeos para Reels',
      })
      .returning();

    const res = await call(reception.cookie, 'GET', `/admin/customers/${user.id}`);

    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body['profile']).toMatchObject({
      id: user.id,
      name: 'Clara Mendes',
      docType: 'cpf',
      notes: null,
    });
    expect(body['bookings']).toEqual({
      items: [
        {
          id: booking.id,
          code: booking.code,
          roomName: room.name,
          startsAt: booking.startsAt.toISOString(),
          endsAt: booking.endsAt.toISOString(),
          status: 'confirmed',
          totalCents: 16_000,
        },
      ],
      nextCursor: null,
    });
    expect(body['subscriptions']).toEqual([
      expect.objectContaining({
        id: subscription.id,
        categoryName: 'Pacote 20h mensal',
        roomName: null,
        status: 'active',
        baseOn: '2027-02-15',
        balanceMinutes: 600,
      }),
    ]);
    expect(body['extraLots']).toEqual([
      { id: lot.id, source: 'purchase', remainingMinutes: 120, expiresOn: '2027-05-01' },
    ]);
    expect(body['credits']).toEqual([
      { id: credit.id, source: 'manual', remainingCents: 3000, expiresOn: '2027-05-01' },
    ]);
    expect(body['couponUses']).toEqual([
      {
        id: use.id,
        code: 'BEMVINDO',
        status: 'consumed',
        discountCents: 1600,
        usedAt: use.createdAt.toISOString(),
      },
    ]);
    expect(body['consents']).toEqual([
      {
        id: consent!.id,
        kind: 'booking_policy',
        version: '1',
        acceptedAt: consent!.acceptedAt.toISOString(),
      },
    ]);
    expect(body['quoteRequests']).toEqual([
      {
        id: quote!.id,
        serviceName: 'Videomaker',
        status: 'new',
        createdAt: quote!.createdAt.toISOString(),
      },
    ]);
  });

  it('pages the bookings newest first (20 in the detail, the rest through /bookings)', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const { user } = await createTenant(db, { now: NOW });
    const room = await seededRoom(db);
    for (let day = 1; day <= 21; day++) {
      const date = `2027-01-${String(day).padStart(2, '0')}` as LocalDate;
      await insertBooking(db, {
        userId: user.id,
        roomId: room.id,
        startsAt: localToUtc(date, 600),
        endsAt: localToUtc(date, 660),
        status: 'completed',
        occupancy: false,
      });
    }

    const detail = await call(admin.cookie, 'GET', `/admin/customers/${user.id}`);
    const page = (
      detail.body as { bookings: { items: { startsAt: string }[]; nextCursor: string } }
    ).bookings;
    const rest = await call(
      admin.cookie,
      'GET',
      `/admin/customers/${user.id}/bookings?cursor=${page.nextCursor}`,
    );

    expect(page.items).toHaveLength(20);
    expect(page.items[0]?.startsAt).toBe(localToUtc('2027-01-21', 600).toISOString());
    const restBody = rest.body as { items: { startsAt: string }[]; nextCursor: null };
    expect(restBody.items.map((i) => i.startsAt)).toEqual([
      localToUtc('2027-01-01', 600).toISOString(),
    ]);
    expect(restBody.nextCursor).toBeNull();
  });

  it('answers 404 for a staff account or an unknown id', async () => {
    const admin = await createStaff(db, 'admin', NOW);

    const staff = await call(admin.cookie, 'GET', `/admin/customers/${admin.user.id}`);
    const unknown = await call(admin.cookie, 'GET', `/admin/customers/${randomUUID()}`);

    expect([staff.status, unknown.status]).toEqual([404, 404]);
  });
});

describe('customer notes and profile edit (GES-101, GES-102)', () => {
  it('reception saves notes (audited customer.notes) but gets 403 on the profile edit', async () => {
    const reception = await createStaff(db, 'reception', NOW);
    const { user } = await createTenant(db, { now: NOW });

    const notes = await call(reception.cookie, 'PATCH', `/admin/customers/${user.id}/notes`, {
      notes: 'Prefere horários pela manhã',
    });
    const tooLong = await call(reception.cookie, 'PATCH', `/admin/customers/${user.id}/notes`, {
      notes: 'x'.repeat(4001),
    });
    const edit = await call(reception.cookie, 'PATCH', `/admin/customers/${user.id}`, {
      name: 'Outro Nome',
    });

    expect(notes.status).toBe(200);
    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row?.notes).toBe('Prefere horários pela manhã');
    expect(row?.name).not.toBe('Outro Nome');
    const [entry] = await audits('customer.notes');
    expect(entry).toMatchObject({
      entityType: 'user',
      entityId: user.id,
      actorUserId: reception.user.id,
      after: { notes: 'Prefere horários pela manhã' },
    });
    expect([tooLong.status, tooLong.error?.details?.[0]?.path]).toEqual([422, 'notes']);
    expect([edit.status, edit.error?.code]).toEqual([403, 'FORBIDDEN']);
  });

  it('an admin edit saves the fields (phone in E.164) with audit customer.update', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const { user } = await createTenant(db, { now: NOW, name: 'Clara Mendes' });

    const res = await call(admin.cookie, 'PATCH', `/admin/customers/${user.id}`, {
      name: 'Clara Mendes Souza',
      phone: '(47) 99123-4567',
      profession: 'Psicóloga',
      professionalRegistry: 'CRP 12/34567',
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      name: 'Clara Mendes Souza',
      phone: '+5547991234567',
      profession: 'Psicóloga',
      professionalRegistry: 'CRP 12/34567',
    });
    const [entry] = await audits('customer.update');
    expect(entry).toMatchObject({
      entityId: user.id,
      actorUserId: admin.user.id,
      before: { name: 'Clara Mendes', phone: null, profession: null },
      after: { name: 'Clara Mendes Souza', phone: '+5547991234567', profession: 'Psicóloga' },
    });
  });
});

describe('customer MCP tools', () => {
  it('customers_search, customer_get and customer_notes_update run with origin mcp', async () => {
    await withTransaction(db, (tx) => saveSetting(tx, 'mcp.enabled', true, null));
    const admin = await createStaff(db, 'admin', NOW);
    const { user } = await createTenant(db, { now: NOW, name: 'Clara Mendes' });
    const { token } = (
      await call(admin.cookie, 'POST', '/admin/integrations/mcp/tokens', {
        name: 'Assistente',
        scope: 'read_write',
      })
    ).body as { token: string };
    const client = await connectMcp(buildApp(), token);

    const found = await client.callTool({ name: 'customers_search', arguments: { q: 'clara' } });
    const detail = await client.callTool({ name: 'customer_get', arguments: { id: user.id } });
    const noted = await client.callTool({
      name: 'customer_notes_update',
      arguments: { id: user.id, notes: 'Ligar antes da reserva' },
    });
    await client.close();

    expect((found.structuredContent as { items: { id: string }[] }).items.map((i) => i.id)).toEqual(
      [user.id],
    );
    expect(detail.structuredContent).toMatchObject({ profile: { name: 'Clara Mendes' } });
    expect(noted.structuredContent).toEqual({ notes: 'Ligar antes da reserva' });
    const [entry] = await audits('customer.notes');
    expect(entry).toMatchObject({ origin: 'mcp', actorUserId: admin.user.id });
  });
});
