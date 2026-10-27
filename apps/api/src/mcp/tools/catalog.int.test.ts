import { formatBRL, localToUtc, type LocalDate } from '@bravo/core';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCharge, createStaff, createTenant, seededRoom } from '../../../test/booking-helpers';
import { createBooking as insertBooking } from '../../../test/factories';
import { forbiddenFetch, send, testEnv } from '../../../test/http';
import { connectMcp, toolErrorOf } from '../../../test/mcp-client';
import { requireTestDatabaseUrl } from '../../../test/require-test-db';
import { createApp } from '../../app';
import { createDb, withTransaction } from '../../db/client';
import { auditLog, blocks, bookings } from '../../db/schema';
import { runSeed } from '../../db/seed';
import { saveSetting } from '../../modules/settings/settings.repo';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

const NOW = new Date('2027-03-10T15:00:00.000Z');
const DAY_AHEAD = '2027-03-17' as LocalDate;

/**
 * The nucleo and receita rows of design "MCP tool catalog", in table order (gestao-backed tools
 * are added to this table by the tasks that register them).
 */
const DESIGN_TABLE: [name: string, scope: 'read' | 'write', destructive: boolean][] = [
  ['agenda_list', 'read', false],
  ['availability_get', 'read', false],
  ['booking_get', 'read', false],
  ['bookings_search', 'read', false],
  ['booking_create', 'write', false],
  ['pre_reservation_create', 'write', false],
  ['booking_confirm_manual', 'write', false],
  ['booking_check_in', 'write', false],
  ['booking_resend_payment_link', 'write', false],
  ['booking_reschedule', 'write', false],
  ['booking_cancel', 'write', true],
  ['refund_create', 'write', true],
  ['block_create', 'write', false],
  ['block_remove', 'write', true],
  ['slot_discount_apply', 'write', false],
  ['slot_discount_remove', 'write', true],
  ['subscriptions_list', 'read', false],
  ['subscription_sell', 'write', false],
  ['subscription_cancel', 'write', true],
  ['coupons_list', 'read', false],
  ['coupon_create', 'write', false],
  ['coupon_set_enabled', 'write', false],
  ['credit_grant', 'write', false],
  ['categories_list', 'read', false],
  ['policies_get', 'read', false],
];

let roomId = '';
let clients: Client[] = [];

beforeEach(async () => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  await runSeed(db);
  roomId = (await seededRoom(db)).id;
  await withTransaction(db, (tx) => saveSetting(tx, 'mcp.enabled', true, null));
  for (const client of clients) await client.close();
  clients = [];
});

const buildApp = () => createApp({ db, now: () => NOW, fetch: forbiddenFetch, env: testEnv() });

async function clientFor(scope: 'read' | 'read_write') {
  const admin = await createStaff(db, 'admin', NOW);
  const res = await send(buildApp(), 'POST', '/admin/integrations/mcp/tokens', {
    cookie: admin.cookie,
    body: { name: `Teste ${scope}`, scope },
  });
  const { token, record } = res.body as { token: string; record: { id: string } };
  const client = await connectMcp(buildApp(), token);
  clients.push(client);
  return { client, admin, tokenId: record.id };
}

const audits = (action: string) => db.select().from(auditLog).where(eq(auditLog.action, action));

async function paidBooking() {
  const { user } = await createTenant(db, { now: NOW, name: 'Paula Reis' });
  const row = await insertBooking(db, {
    userId: user.id,
    roomId,
    startsAt: localToUtc(DAY_AHEAD, 840),
    endsAt: localToUtc(DAY_AHEAD, 960),
    totalCents: 16000,
    depositCents: 8000,
    paidCents: 16000,
  });
  for (const purpose of ['booking_deposit', 'booking_balance']) {
    await createCharge(db, {
      userId: user.id,
      bookingId: row.id,
      purpose,
      amountCents: 8000,
      approvedAt: new Date(NOW.getTime() - 86_400_000),
    });
  }
  return { user, row };
}

describe('tools/list (GES-57)', () => {
  it('lists the design catalog for a read_write token, in table order with its flags', async () => {
    const { client } = await clientFor('read_write');

    const { tools } = await client.listTools();

    expect(
      tools.map((t) => [
        t.name,
        t.annotations?.readOnlyHint === true ? 'read' : 'write',
        t.annotations?.destructiveHint === true,
      ]),
    ).toEqual(DESIGN_TABLE);
    for (const tool of tools) {
      expect(tool.description?.length ?? 0).toBeGreaterThan(10);
      expect(tool.inputSchema.type).toBe('object');
    }
    const cancel = tools.find((t) => t.name === 'booking_cancel');
    expect(Object.keys(cancel?.inputSchema.properties ?? {})).toEqual(
      expect.arrayContaining(['bookingId', 'reason', 'resolution', 'confirm']),
    );
    const reschedule = tools.find((t) => t.name === 'booking_reschedule');
    expect(Object.keys(reschedule?.inputSchema.properties ?? {})).toEqual(
      expect.arrayContaining(['bookingId', 'date', 'startMinute', 'endMinute']),
    );
  });

  it('lists only the read tools for a read token', async () => {
    const { client } = await clientFor('read');

    const { tools } = await client.listTools();

    expect(tools.map((t) => t.name)).toEqual(
      DESIGN_TABLE.filter(([, scope]) => scope === 'read').map(([name]) => name),
    );
  });
});

describe('scope and confirmation (GES-58, GES-59, GES-61)', () => {
  it('refuses booking_create to a read token with FORBIDDEN and creates nothing', async () => {
    const { client, tokenId } = await clientFor('read');
    const { user } = await createTenant(db, { now: NOW });

    const result = await client.callTool({
      name: 'booking_create',
      arguments: { userId: user.id, roomId, date: DAY_AHEAD, startMinute: 840, endMinute: 900 },
    });

    expect(result.isError).toBe(true);
    expect(toolErrorOf(result).code).toBe('FORBIDDEN');
    expect(await db.select().from(bookings)).toHaveLength(0);
    const [entry] = await audits('mcp.booking_create');
    expect(entry).toMatchObject({
      origin: 'mcp',
      entityId: tokenId,
      after: { ok: false, error: 'FORBIDDEN' },
    });
  });

  it('answers CONFIRMATION_REQUIRED with a pt-BR preview to booking_cancel without confirm', async () => {
    const { client } = await clientFor('read_write');
    const { row } = await paidBooking();

    const result = await client.callTool({
      name: 'booking_cancel',
      arguments: { bookingId: row.id, reason: 'Sala em manutenção', resolution: 'refund' },
    });

    expect(result.isError).toBe(true);
    const error = toolErrorOf(result);
    expect(error.code).toBe('CONFIRMATION_REQUIRED');
    const preview = (error.details as { preview: string }).preview;
    expect(preview).toContain(`Cancelar a reserva ${row.code}`);
    expect(preview).toContain('Sala Principal');
    expect(preview).toContain(`o cliente recebe ${formatBRL(16000)} de volta`);
    expect(error.message).toContain('confirm: true');
    const [stored] = await db.select().from(bookings).where(eq(bookings.id, row.id));
    expect(stored?.status).toBe('confirmed');
    expect(await audits('booking.cancel_by_clinic')).toHaveLength(0);
  });

  it('cancels with confirm: true and writes the service audit with origin mcp', async () => {
    const { client, admin } = await clientFor('read_write');
    const { row } = await paidBooking();

    const result = await client.callTool({
      name: 'booking_cancel',
      arguments: {
        bookingId: row.id,
        reason: 'Sala em manutenção',
        resolution: 'refund',
        justification: 'Vazamento no teto',
        confirm: true,
      },
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ id: row.id, status: 'cancelled_by_clinic' });
    const [stored] = await db.select().from(bookings).where(eq(bookings.id, row.id));
    expect(stored?.status).toBe('cancelled_by_clinic');
    const [serviceAudit] = await audits('booking.cancel_by_clinic');
    expect(serviceAudit).toMatchObject({
      origin: 'mcp',
      actorUserId: admin.user.id,
      entityId: row.id,
      justification: 'Vazamento no teto',
    });
    expect((await audits('mcp.booking_cancel')).map((a) => a.after)).toEqual([
      expect.objectContaining({ ok: true }),
    ]);
  });
});

describe('block tools (GES-59)', () => {
  it('creates a block, previews its removal without confirm, and removes it with confirm', async () => {
    const { client } = await clientFor('read_write');

    const created = await client.callTool({
      name: 'block_create',
      arguments: {
        roomIds: [roomId],
        tag: 'Manutenção',
        date: DAY_AHEAD,
        startMinute: 600,
        endMinute: 720,
      },
    });
    const blockId = (created.structuredContent as { items: { id: string }[] }).items[0]?.id ?? '';
    const unconfirmed = await client.callTool({ name: 'block_remove', arguments: { blockId } });
    const kept = await db.select().from(blocks).where(eq(blocks.id, blockId));
    const removed = await client.callTool({
      name: 'block_remove',
      arguments: { blockId, confirm: true },
    });

    expect(created.isError).toBeFalsy();
    expect(toolErrorOf(unconfirmed).code).toBe('CONFIRMATION_REQUIRED');
    expect((toolErrorOf(unconfirmed).details as { preview: string }).preview).toBe(
      'Remover o bloqueio "Manutenção" da Sala Principal em 17/03/2027 10:00; o horário volta a ficar disponível.',
    );
    expect(kept[0]?.cancelledAt).toBeNull();
    expect(removed.structuredContent).toEqual({ removed: true });
    const [after] = await db.select().from(blocks).where(eq(blocks.id, blockId));
    expect(after?.cancelledAt?.toISOString()).toBe(NOW.toISOString());
    const [entry] = await audits('block.delete');
    expect(entry).toMatchObject({ origin: 'mcp', entityId: blockId });
  });
});

describe('validation and happy paths (GES-62)', () => {
  it('answers VALIDATION_FAILED with the core pt-BR messages', async () => {
    const { client } = await clientFor('read_write');

    const range = await client.callTool({
      name: 'agenda_list',
      arguments: { from: '2027-03-10', to: '2027-06-10' },
    });
    const create = await client.callTool({
      name: 'booking_create',
      arguments: { userId: 'nope', roomId, date: DAY_AHEAD, startMinute: 900, endMinute: 840 },
    });

    expect(toolErrorOf(range)).toMatchObject({
      code: 'VALIDATION_FAILED',
      details: [{ path: 'to', message: 'O período precisa ter no máximo 42 dias' }],
    });
    const createError = toolErrorOf(create);
    expect(createError.code).toBe('VALIDATION_FAILED');
    expect(createError.details).toEqual(
      expect.arrayContaining([{ path: 'userId', message: 'Identificador inválido' }]),
    );
    expect(await db.select().from(bookings)).toHaveLength(0);
  });

  it('agenda_list returns the bookings of the period', async () => {
    const { client } = await clientFor('read');
    const { row } = await paidBooking();

    const result = await client.callTool({
      name: 'agenda_list',
      arguments: { from: '2027-03-15', to: '2027-03-21', roomId },
    });

    expect(result.isError).toBeFalsy();
    const content = result.structuredContent as {
      bookings: { id: string; code: string; firstName: string }[];
    };
    expect(content.bookings.map((b) => [b.id, b.code, b.firstName])).toEqual([
      [row.id, row.code, 'Paula'],
    ]);
  });

  it('booking_get finds a booking by its code', async () => {
    const { client } = await clientFor('read');
    const { row } = await paidBooking();

    const result = await client.callTool({ name: 'booking_get', arguments: { code: row.code } });
    const missing = await client.callTool({ name: 'booking_get', arguments: {} });

    expect(result.structuredContent).toMatchObject({ id: row.id, code: row.code });
    expect(toolErrorOf(missing)).toMatchObject({
      code: 'VALIDATION_FAILED',
      details: [{ path: 'id', message: 'Informe o id ou o código da reserva' }],
    });
  });

  it('pre_reservation_create holds the slot and returns the payment link, audited with origin mcp', async () => {
    const { client, admin } = await clientFor('read_write');
    const { user } = await createTenant(db, { now: NOW });

    const result = await client.callTool({
      name: 'pre_reservation_create',
      arguments: {
        userId: user.id,
        roomId,
        date: DAY_AHEAD,
        startMinute: 840,
        endMinute: 900,
        expiresInHours: 48,
      },
    });

    expect(result.isError).toBeFalsy();
    const created = result.structuredContent as {
      id: string;
      status: string;
      holdExpiresAt: string;
      paymentLink: string;
    };
    expect(created.status).toBe('pre_reserved');
    expect(created.holdExpiresAt).toBe(new Date(NOW.getTime() + 48 * 3_600_000).toISOString());
    expect(created.paymentLink).toContain('/pre-reserva/');
    const [stored] = await db.select().from(bookings).where(eq(bookings.id, created.id));
    expect(stored).toMatchObject({ userId: user.id, status: 'pre_reserved' });
    const [entry] = await audits('booking.create');
    expect(entry).toMatchObject({
      origin: 'mcp',
      actorUserId: admin.user.id,
      entityId: created.id,
    });
  });
});
