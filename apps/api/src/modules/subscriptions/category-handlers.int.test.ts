import { adminCategorySchema } from '@bravo/core';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createStaff, createTenant } from '../../../test/booking-helpers';
import {
  createFixedCategory,
  createHourPackageCategory,
  createSubscription,
} from '../../../test/factories/revenue';
import { forbiddenFetch, send, testEnv } from '../../../test/http';
import { requireTestDatabaseUrl } from '../../../test/require-test-db';
import { createApp } from '../../app';
import { createDb } from '../../db/client';
import { auditLog, bookingCategories, emailOutbox } from '../../db/schema';
import { runSeed } from '../../db/seed';
import { LOCKED_CATEGORY_MESSAGE } from './category-handlers';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

const NOW = new Date('2026-11-05T12:00:00.000Z');
const app = () => createApp({ db, now: () => NOW, fetch: forbiddenFetch, env: testEnv() });
let adminCookie = '';

beforeEach(async () => {
  await runSeed(db);
  adminCookie = (await createStaff(db, 'admin', NOW)).cookie;
});

const call = (method: string, path: string, body?: unknown) =>
  send(app(), method, path, { cookie: adminCookie, ...(body !== undefined && { body }) });

const rowOf = async (id: string) =>
  (await db.select().from(bookingCategories).where(eq(bookingCategories.id, id)))[0];

const pacote25 = {
  type: 'hour_package',
  name: 'Pacote 25h mensal',
  fixedPriceCents: 187_500,
  includedHours: 25,
  period: 'monthly',
};
const tueThu = {
  type: 'fixed_schedule',
  name: 'Tarde ter/qui',
  weekdays: [2, 4],
  startMinute: 840,
  endMinute: 1080,
  pricePerOccurrenceCents: 30_000,
  period: 'monthly',
};

describe('creating package categories (REC-01, REC-02)', () => {
  it('stores Pacote 25h mensal with 1500 included minutes and R$ 75,00/h', async () => {
    const res = await call('POST', '/admin/categories', pacote25);
    expect(res.status).toBe(201);
    const category = adminCategorySchema.parse(res.body);
    expect(category).toMatchObject({
      type: 'hour_package',
      fixedPriceCents: 187_500,
      includedMinutes: 1500,
      period: 'monthly',
      averageHourlyCents: 7500,
      editable: true,
    });
    expect(await rowOf(category.id)).toMatchObject({ includedMinutes: 1500, period: 'monthly' });
  });

  it('stores a Tue/Thu 14:00–18:00 fixed schedule', async () => {
    const res = await call('POST', '/admin/categories', tueThu);
    expect(res.status).toBe(201);
    expect(adminCategorySchema.parse(res.body)).toMatchObject({
      type: 'fixed_schedule',
      weekdays: [2, 4],
      startMinute: 840,
      endMinute: 1080,
      pricePerOccurrenceCents: 30_000,
    });
  });

  it.each([
    ['0 included hours', { ...pacote25, includedHours: 0 }, 'includedHours'],
    ['201 included hours', { ...pacote25, includedHours: 201 }, 'includedHours'],
    ['period single', { ...pacote25, period: 'single' }, 'period'],
    ['a zero price', { ...pacote25, fixedPriceCents: 0 }, 'fixedPriceCents'],
    ['a window off the 30-min grid', { ...tueThu, startMinute: 845 }, 'startMinute'],
    ['a window shorter than the default booking', { ...tueThu, endMinute: 870 }, 'endMinute'],
    ['no weekday', { ...tueThu, weekdays: [] }, 'weekdays'],
  ])('rejects %s with 422 VALIDATION_FAILED', async (_name, body, path) => {
    const before = (await db.select().from(bookingCategories)).length;
    const res = await call('POST', '/admin/categories', body);
    expect(res.status).toBe(422);
    expect(res.error?.code).toBe('VALIDATION_FAILED');
    expect(res.error?.details?.map((d) => d.path)).toContain(path);
    expect(await db.select().from(bookingCategories)).toHaveLength(before);
  });
});

describe('editing package categories (REC-05, REC-06)', () => {
  it('locks the window of a category with an active subscription with 409 and the REC-05 message', async () => {
    const category = await createFixedCategory(db);
    const { user } = await createTenant(db);
    const [principal] = (
      await pool.query<{ id: string }>(`select id from rooms where slug = 'principal'`)
    ).rows;
    await createSubscription(db, {
      userId: user.id,
      category,
      roomId: principal?.id ?? null,
      period: null,
    });
    const res = await call('PATCH', `/admin/categories/${category.id}`, {
      startMinute: 480,
      endMinute: 630,
    });
    expect(res.status).toBe(409);
    expect(res.error).toMatchObject({ code: 'CONFLICT', message: LOCKED_CATEGORY_MESSAGE });
    expect(await rowOf(category.id)).toMatchObject({
      startMinute: 420,
      endMinute: 570,
      version: 1,
    });
  });

  it('accepts a window change while nobody subscribes, with a version bump', async () => {
    const category = await createFixedCategory(db);
    const res = await call('PATCH', `/admin/categories/${category.id}`, {
      startMinute: 480,
      endMinute: 630,
    });
    expect(res.status).toBe(200);
    expect(await rowOf(category.id)).toMatchObject({
      startMinute: 480,
      endMinute: 630,
      version: 2,
    });
  });

  it('a price change bumps the version, audits it and e-mails each active or suspended subscriber', async () => {
    const category = await createHourPackageCategory(db, { name: 'Pacote 20h mensal (teste)' });
    const active = await createTenant(db);
    const suspended = await createTenant(db);
    const pending = await createTenant(db);
    await createSubscription(db, { userId: active.user.id, category });
    await createSubscription(db, { userId: suspended.user.id, category, status: 'suspended' });
    await createSubscription(db, { userId: pending.user.id, category, status: 'awaiting_payment' });

    const res = await call('PATCH', `/admin/categories/${category.id}`, {
      fixedPriceCents: 175_000,
    });
    expect(res.status).toBe(200);
    expect(await rowOf(category.id)).toMatchObject({ fixedPriceCents: 175_000, version: 2 });
    const [audit] = await db.select().from(auditLog).where(eq(auditLog.action, 'category.update'));
    expect(audit?.before).toMatchObject({ fixedPriceCents: 160_000 });
    expect(audit?.after).toMatchObject({ fixedPriceCents: 175_000, version: 2 });
    const mails = await db
      .select()
      .from(emailOutbox)
      .where(eq(emailOutbox.template, 'subscription.price_change'));
    expect(mails.map((m) => m.toAddress).sort()).toEqual(
      [active.user.email, suspended.user.email].sort(),
    );
    expect(mails[0]?.textBody.replaceAll(' ', ' ')).toContain('R$ 1.750,00');
    expect(mails[0]?.textBody).toContain('02/12/2026');
  });

  it('PATCH includedHours stores the minutes and counts as a price change', async () => {
    const category = await createHourPackageCategory(db);
    const res = await call('PATCH', `/admin/categories/${category.id}`, { includedHours: 25 });
    expect(res.status).toBe(200);
    expect(await rowOf(category.id)).toMatchObject({ includedMinutes: 1500, version: 2 });
  });

  it('PATCH pricePerOccurrenceCents on a fixed schedule e-mails the per-occurrence value', async () => {
    const category = await createFixedCategory(db);
    const { user } = await createTenant(db);
    const [principal] = (
      await pool.query<{ id: string }>(`select id from rooms where slug = 'principal'`)
    ).rows;
    await createSubscription(db, { userId: user.id, category, roomId: principal?.id ?? null });
    const res = await call('PATCH', `/admin/categories/${category.id}`, {
      pricePerOccurrenceCents: 30_000,
    });
    expect(res.status).toBe(200);
    expect(await rowOf(category.id)).toMatchObject({ pricePerOccurrenceCents: 30_000, version: 2 });
    const [mail] = await db
      .select()
      .from(emailOutbox)
      .where(
        and(
          eq(emailOutbox.template, 'subscription.price_change'),
          eq(emailOutbox.toAddress, user.email),
        ),
      );
    expect(mail?.textBody.replaceAll(' ', ' ')).toContain('R$ 300,00 por ocorrência');
  });
});
