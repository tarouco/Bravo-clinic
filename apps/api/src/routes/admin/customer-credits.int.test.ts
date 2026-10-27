import { randomUUID } from 'node:crypto';
import { creditsSummarySchema } from '@bravo/core';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createStaff, createTenant } from '../../../test/booking-helpers';
import { createCreditLot } from '../../../test/factories/revenue';
import { forbiddenFetch, send, testEnv } from '../../../test/http';
import { requireTestDatabaseUrl } from '../../../test/require-test-db';
import { createApp } from '../../app';
import { createDb } from '../../db/client';
import { auditLog, creditLots } from '../../db/schema';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

const NOW = new Date('2026-11-01T12:00:00.000Z');
const app = () => createApp({ db, now: () => NOW, fetch: forbiddenFetch, env: testEnv() });
const lotResult = z.object({ lot: creditsSummarySchema.shape.lots.element });

const grant = (cookie: string, userId: string, body: unknown) =>
  send(app(), 'POST', `/admin/customers/${userId}/credits`, {
    cookie,
    body,
    headers: { 'Idempotency-Key': randomUUID() },
  });

describe('POST /admin/customers/:userId/credits (REC-112)', () => {
  it('grants a manual credit for the admin and audits credit.grant_manual', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const { user } = await createTenant(db);
    const res = await grant(admin.cookie, user.id, {
      amountCents: 5000,
      justification: 'Cortesia pelo atraso',
    });
    expect(res.status).toBe(201);
    const { lot } = lotResult.parse(res.body);
    expect(lot).toMatchObject({
      source: 'manual',
      label: 'Crédito manual',
      amountCents: 5000,
      remainingCents: 5000,
      expiresAt: '2027-01-30T12:00:00.000Z',
    });
    const [row] = await db.select().from(creditLots).where(eq(creditLots.id, lot.id));
    expect(row).toMatchObject({ userId: user.id, justification: 'Cortesia pelo atraso' });
    const audits = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'credit.grant_manual'));
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      entityId: lot.id,
      actorUserId: admin.user.id,
      justification: 'Cortesia pelo atraso',
    });
  });

  it('answers 403 FORBIDDEN to reception and creates nothing', async () => {
    const reception = await createStaff(db, 'reception', NOW);
    const { user } = await createTenant(db);
    const res = await grant(reception.cookie, user.id, {
      amountCents: 5000,
      justification: 'Cortesia pelo atraso',
    });
    expect(res.status).toBe(403);
    expect(res.error?.code).toBe('FORBIDDEN');
    expect(await db.select().from(creditLots)).toHaveLength(0);
  });

  it('answers 422 without a justification and for amount 0', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const { user } = await createTenant(db);
    const missing = await grant(admin.cookie, user.id, { amountCents: 5000 });
    const zero = await grant(admin.cookie, user.id, { amountCents: 0, justification: 'Cortesia' });
    expect(missing.status).toBe(422);
    expect(missing.error?.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'justification' })]),
    );
    expect(zero.status).toBe(422);
    expect(zero.error?.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'amountCents' })]),
    );
    expect(await db.select().from(creditLots)).toHaveLength(0);
  });

  it('answers 404 for an unknown customer', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const res = await grant(admin.cookie, randomUUID(), {
      amountCents: 5000,
      justification: 'Cortesia pelo atraso',
    });
    expect(res.status).toBe(404);
  });
});

describe('GET /admin/customers/:userId/credits', () => {
  it('lets reception read the customer credits summary', async () => {
    const reception = await createStaff(db, 'reception', NOW);
    const { user } = await createTenant(db);
    await createCreditLot(db, {
      userId: user.id,
      amountCents: 20533,
      source: 'closed_day_compensation',
    });
    const res = await send(app(), 'GET', `/admin/customers/${user.id}/credits`, {
      cookie: reception.cookie,
    });
    expect(res.status).toBe(200);
    const body = creditsSummarySchema.parse(res.body);
    expect(body.availableCents).toBe(20533);
    expect(body.lots[0]).toMatchObject({
      label: 'Compensação de dia fechado',
      remainingCents: 20533,
    });
    expect(body.ledger[0]).toMatchObject({ entryType: 'grant', amountCents: 20533 });
  });

  it('answers 401 without a session', async () => {
    const res = await send(app(), 'GET', `/admin/customers/${randomUUID()}/credits`);
    expect(res.status).toBe(401);
  });
});
