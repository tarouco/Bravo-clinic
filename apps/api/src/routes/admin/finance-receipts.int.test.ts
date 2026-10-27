import { localToUtc } from '@bravo/core';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStaff, createTenant, seededRoom } from '../../../test/booking-helpers';
import { createBooking as insertBooking } from '../../../test/factories';
import { forbiddenFetch, send, testEnv } from '../../../test/http';
import { connectMcp } from '../../../test/mcp-client';
import { requireTestDatabaseUrl } from '../../../test/require-test-db';
import { createApp } from '../../app';
import { createDb, withTransaction } from '../../db/client';
import { auditLog, manualReceipts } from '../../db/schema';
import { runSeed } from '../../db/seed';
import { saveSetting } from '../../modules/settings/settings.repo';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

const NOW = new Date('2027-03-10T15:00:00.000Z');

beforeEach(async () => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  await runSeed(db);
});

const buildApp = () => createApp({ db, now: () => NOW, fetch: forbiddenFetch, env: testEnv() });
const call = (cookie: string, method: string, path: string, body?: unknown) =>
  send(buildApp(), method, path, { cookie, ...(body !== undefined && { body }) });

const audits = (action: string) => db.select().from(auditLog).where(eq(auditLog.action, action));

const receiptBody = (overrides: Record<string, unknown> = {}) => ({
  date: '2027-03-08',
  revenueCategory: 'rental_single',
  method: 'cash',
  amountCents: 9_700,
  description: 'Hora avulsa paga na recepção',
  ...overrides,
});

async function customerBooking() {
  const { user } = await createTenant(db, { now: NOW, name: 'Clara Mendes' });
  const room = await seededRoom(db);
  const booking = await insertBooking(db, {
    userId: user.id,
    roomId: room.id,
    startsAt: localToUtc('2027-03-08', 840),
    endsAt: localToUtc('2027-03-08', 900),
    occupancy: false,
  });
  return { user, booking };
}

describe('POST /admin/finance/receipts (GES-20)', () => {
  it('records the receipt with customer and booking (201) and audits manual_receipt.create', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const { user, booking } = await customerBooking();

    const res = await call(
      admin.cookie,
      'POST',
      '/admin/finance/receipts',
      receiptBody({ userId: user.id, bookingId: booking.id }),
    );

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: expect.any(String) as string,
      date: '2027-03-08',
      revenueCategory: 'rental_single',
      method: 'cash',
      amountCents: 9_700,
      description: 'Hora avulsa paga na recepção',
      customerName: 'Clara Mendes',
      bookingCode: booking.code,
    });
    const [row] = await db.select().from(manualReceipts);
    expect(row).toMatchObject({ userId: user.id, bookingId: booking.id, createdBy: admin.user.id });
    const [entry] = await audits('manual_receipt.create');
    expect(entry).toMatchObject({
      entityType: 'manual_receipt',
      entityId: row?.id,
      actorUserId: admin.user.id,
      after: { amountCents: 9_700, method: 'cash', revenueCategory: 'rental_single' },
    });
  });

  it('answers 422 for an invalid method or amount, an unknown customer or another customer’s booking', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const { booking } = await customerBooking();
    const stranger = await createTenant(db, { now: NOW });

    const invalid = await call(
      admin.cookie,
      'POST',
      '/admin/finance/receipts',
      receiptBody({ method: 'boleto', amountCents: 100_000_001 }),
    );
    const unknownUser = await call(
      admin.cookie,
      'POST',
      '/admin/finance/receipts',
      receiptBody({ userId: '00000000-0000-4000-8000-000000000000' }),
    );
    const foreignBooking = await call(
      admin.cookie,
      'POST',
      '/admin/finance/receipts',
      receiptBody({ userId: stranger.user.id, bookingId: booking.id }),
    );

    expect(invalid.status).toBe(422);
    expect(invalid.error?.details?.map((d) => d.path).sort()).toEqual(['amountCents', 'method']);
    expect(invalid.error?.details?.find((d) => d.path === 'method')?.message).toBe(
      'Escolha a forma de recebimento',
    );
    expect([unknownUser.status, unknownUser.error?.details?.[0]?.path]).toEqual([422, 'userId']);
    expect([foreignBooking.status, foreignBooking.error?.details?.[0]?.path]).toEqual([
      422,
      'bookingId',
    ]);
    expect(await db.select().from(manualReceipts)).toHaveLength(0);
  });
});

describe('DELETE /admin/finance/receipts/:id (GES-21)', () => {
  it('requires a 5..500 char justification, then soft-deletes with it in the audit row', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const created = (await call(admin.cookie, 'POST', '/admin/finance/receipts', receiptBody()))
      .body as { id: string };
    const path = `/admin/finance/receipts/${created.id}`;

    const missing = await call(admin.cookie, 'DELETE', path, {});
    const tooShort = await call(admin.cookie, 'DELETE', path, { justification: 'erro' });
    const res = await call(admin.cookie, 'DELETE', path, {
      justification: 'Lançado em duplicidade',
    });
    const again = await call(admin.cookie, 'DELETE', path, {
      justification: 'Lançado em duplicidade',
    });

    expect([missing.status, missing.error?.details?.[0]?.path]).toEqual([422, 'justification']);
    expect(tooShort.status).toBe(422);
    expect(res.status).toBe(204);
    expect(again.status).toBe(404);
    const [row] = await db.select().from(manualReceipts);
    expect(row?.deletedAt?.toISOString()).toBe(NOW.toISOString());
    const [entry] = await audits('manual_receipt.delete');
    expect(entry).toMatchObject({
      entityId: created.id,
      justification: 'Lançado em duplicidade',
      before: { amountCents: 9_700 },
      after: { deletedAt: NOW.toISOString() },
    });
  });
});

describe('GET /admin/finance/receipts', () => {
  it('lists live receipts of the range newest first; reception gets 403', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const reception = await createStaff(db, 'reception', NOW);
    for (const date of ['2027-03-01', '2027-03-09', '2027-02-28']) {
      await call(admin.cookie, 'POST', '/admin/finance/receipts', receiptBody({ date }));
    }
    const doomed = (
      await call(
        admin.cookie,
        'POST',
        '/admin/finance/receipts',
        receiptBody({ date: '2027-03-05' }),
      )
    ).body as { id: string };
    await call(admin.cookie, 'DELETE', `/admin/finance/receipts/${doomed.id}`, {
      justification: 'Lançado errado',
    });

    const listed = await call(
      admin.cookie,
      'GET',
      '/admin/finance/receipts?from=2027-03-01&to=2027-03-31',
    );
    const forbidden = await call(reception.cookie, 'GET', '/admin/finance/receipts');
    const forbiddenCreate = await call(
      reception.cookie,
      'POST',
      '/admin/finance/receipts',
      receiptBody(),
    );

    const body = listed.body as { items: { date: string; customerName: null }[]; nextCursor: null };
    expect(body.items.map((i) => i.date)).toEqual(['2027-03-09', '2027-03-01']);
    expect(body.items[0]?.customerName).toBeNull();
    expect(body.nextCursor).toBeNull();
    expect([forbidden.status, forbiddenCreate.status]).toEqual([403, 403]);
  });

  it('manual_receipt_create works through MCP with origin mcp', async () => {
    await withTransaction(db, (tx) => saveSetting(tx, 'mcp.enabled', true, null));
    const admin = await createStaff(db, 'admin', NOW);
    const { token } = (
      await call(admin.cookie, 'POST', '/admin/integrations/mcp/tokens', {
        name: 'Assistente',
        scope: 'read_write',
      })
    ).body as { token: string };
    const client = await connectMcp(buildApp(), token);

    const result = await client.callTool({
      name: 'manual_receipt_create',
      arguments: receiptBody({ method: 'pix_direct' }),
    });
    await client.close();

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ method: 'pix_direct', amountCents: 9_700 });
    const [entry] = await audits('manual_receipt.create');
    expect(entry).toMatchObject({ origin: 'mcp', actorUserId: admin.user.id });
  });
});
