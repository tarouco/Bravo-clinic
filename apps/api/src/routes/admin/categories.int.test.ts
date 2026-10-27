import {
  adminCategoryListSchema,
  adminCategorySchema,
  localToUtc,
  pricesReviewedSchema,
} from '@bravo/core';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createBooking, createUser, loginAs } from '../../../test/factories';
import { forbiddenFetch, send, testEnv } from '../../../test/http';
import { requireTestDatabaseUrl } from '../../../test/require-test-db';
import { createApp } from '../../app';
import { createDb } from '../../db/client';
import { auditLog, bookingCategories, bookingSegments, rooms, settings } from '../../db/schema';
import { runSeed } from '../../db/seed';
import { createRegistry, type Registry } from '../../extensions/registry';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

const NOW = new Date('2026-10-20T12:00:00Z');

let adminCookie = '';
let receptionCookie = '';

beforeEach(async () => {
  await runSeed(db);
  adminCookie = await loginAs(db, await createUser(db, { role: 'admin', totp: true }), {
    mfaVerified: true,
    now: NOW,
  });
  receptionCookie = await loginAs(db, await createUser(db, { role: 'reception', totp: true }), {
    mfaVerified: true,
    now: NOW,
  });
});

const call = (method: string, path: string, cookie: string, body?: unknown, registry?: Registry) =>
  send(
    createApp({
      db,
      now: () => NOW,
      fetch: forbiddenFetch,
      env: testEnv(),
      // nucleo alone: the app's default registry now carries receita's package handlers.
      registry: registry ?? createRegistry(),
    }),
    method,
    path,
    { cookie, ...(body !== undefined && { body }) },
  );

const list = async () =>
  adminCategoryListSchema.parse((await call('GET', '/admin/categories', adminCookie)).body).items;
const byName = async (name: string) => (await list()).find((c) => c.name === name);
const actions = async () => (await db.select().from(auditLog)).map((a) => a.action);

const hourly = {
  type: 'hourly',
  name: 'Manhã promocional',
  weekdays: [1, 2, 3, 4, 5],
  appliesOnHolidays: false,
  startMinute: 420,
  endMinute: 720,
  weekdayRateCents: 7000,
  weekendRateCents: 9000,
  minDurationMinutes: 120,
};
const block = {
  type: 'block',
  name: 'Manhã',
  weekdays: [1, 2, 3, 4, 5],
  appliesOnHolidays: true,
  startMinute: 420,
  endMinute: 720,
  fixedPriceCents: 28000,
};

describe('GET /admin/categories (NUC-61)', () => {
  it('returns the 8 seeded categories with average hourly values and editable only on hourly and block', async () => {
    const items = await list();

    expect(items.map((c) => [c.name, c.averageHourlyCents, c.editable])).toEqual([
      ['1 hora', 9700, true],
      ['2 horas ou mais', 8000, true],
      ['1 hora — noite', 12000, true],
      ['2 horas ou mais — noite', 9900, true],
      ['Meio turno mensal', 11200, false],
      ['Turno mensal', 10000, false],
      ['Pacote 20h mensal', 8000, false],
      ['Pacote 30h mensal', 8000, false],
    ]);
    expect(items.map((c) => c.displayOrder)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('answers reception with 403 on every category route', async () => {
    const [first] = await list();
    const id = first?.id ?? '';

    const results = await Promise.all([
      call('GET', '/admin/categories', receptionCookie),
      call('POST', '/admin/categories', receptionCookie, hourly),
      call('PATCH', `/admin/categories/${id}`, receptionCookie, { name: 'Outra' }),
      call('POST', `/admin/categories/${id}/reference`, receptionCookie),
      call('POST', '/admin/categories/reorder', receptionCookie, { ids: [id] }),
      call('POST', '/admin/onboarding/prices-reviewed', receptionCookie),
    ]);

    expect(results.map((r) => [r.status, r.error?.code])).toEqual(
      Array.from({ length: 6 }, () => [403, 'FORBIDDEN']),
    );
  });
});

describe('POST /admin/categories (NUC-62, NUC-63, NUC-64)', () => {
  it('creates an hourly category at the end of the order with version 1 and audits category.create', async () => {
    const res = await call('POST', '/admin/categories', adminCookie, hourly);

    expect(res.status).toBe(201);
    expect(adminCategorySchema.parse(res.body)).toMatchObject({
      name: 'Manhã promocional',
      type: 'hourly',
      period: 'single',
      displayOrder: 9,
      version: 1,
      status: 'active',
      visibility: 'public',
      isReference: false,
      editable: true,
    });
    expect(await actions()).toEqual(['category.create']);
  });

  it.each([
    ['a zero weekday rate', { weekdayRateCents: 0 }, 'weekdayRateCents'],
    ['no weekdays', { weekdays: [] }, 'weekdays'],
    ['a minimum duration off the slot grid', { minDurationMinutes: 45 }, 'minDurationMinutes'],
    ['a window ending before it starts', { startMinute: 720, endMinute: 420 }, 'endMinute'],
    ['a start off the slot grid', { startMinute: 435 }, 'startMinute'],
  ])('rejects %s with 422 and the field path', async (_name, patch, path) => {
    const res = await call('POST', '/admin/categories', adminCookie, { ...hourly, ...patch });

    expect([res.status, res.error?.code]).toEqual([422, 'VALIDATION_FAILED']);
    expect(res.error?.details).toContainEqual(expect.objectContaining({ path }));
    expect(await list()).toHaveLength(8);
  });

  it('creates a block category with period single', async () => {
    const res = await call('POST', '/admin/categories', adminCookie, block);

    expect(adminCategorySchema.parse(res.body)).toMatchObject({
      type: 'block',
      period: 'single',
      fixedPriceCents: 28000,
      averageHourlyCents: 5600,
    });
  });

  it('rejects hour_package with 422 on path type while no handler is registered', async () => {
    const res = await call('POST', '/admin/categories', adminCookie, {
      type: 'hour_package',
      name: 'Pacote 10h',
    });

    expect([res.status, res.error?.code]).toEqual([422, 'VALIDATION_FAILED']);
    expect(res.error?.details).toEqual([
      { path: 'type', message: 'Tipo de categoria gerenciado em Pacotes' },
    ]);
  });

  it('delegates a package category to a registered handler and runs onUpdate before persisting', async () => {
    const seenBeforePersist: string[] = [];
    const registry = createRegistry({
      categoryHandlers: [
        {
          type: 'hour_package',
          schema: z.looseObject({ name: z.string(), price: z.number() }),
          toRow: (input) => {
            const { name, price } = input as { name: string; price: number };
            return { name, fixedPriceCents: price, includedMinutes: 600, period: 'monthly' };
          },
          onUpdate: async (tx, before, after) => {
            const [stored] = await tx
              .select({ name: bookingCategories.name })
              .from(bookingCategories)
              .where(eq(bookingCategories.id, before.id));
            seenBeforePersist.push(`${before.name}|${after.name}|stored:${stored?.name ?? ''}`);
          },
        },
      ],
    });

    const created = await call(
      'POST',
      '/admin/categories',
      adminCookie,
      { type: 'hour_package', name: 'Pacote 10h', price: 80000 },
      registry,
    );
    const id = adminCategorySchema.parse(created.body).id;
    const updated = await call(
      'PATCH',
      `/admin/categories/${id}`,
      adminCookie,
      { name: 'Pacote 10h plus', fixedPriceCents: 90000 },
      registry,
    );

    expect(created.status).toBe(201);
    expect(adminCategorySchema.parse(created.body)).toMatchObject({
      type: 'hour_package',
      fixedPriceCents: 80000,
      editable: true,
    });
    expect(seenBeforePersist).toEqual(['Pacote 10h|Pacote 10h plus|stored:Pacote 10h']);
    expect(adminCategorySchema.parse(updated.body)).toMatchObject({
      name: 'Pacote 10h plus',
      version: 2,
    });
  });
});

describe('PATCH /admin/categories/:id (NUC-65, NUC-67)', () => {
  it('bumps the version, audits before and after and leaves a booking segment at the frozen 9700', async () => {
    const hour = await byName('1 hora');
    const [room] = await db.select().from(rooms).where(eq(rooms.slug, 'principal'));
    const booking = await createBooking(db, {
      userId: (await createUser(db)).id,
      roomId: room?.id ?? '',
      startsAt: localToUtc('2026-10-27', 840),
      endsAt: localToUtc('2026-10-27', 900),
      totalCents: 9700,
    });

    const res = await call('PATCH', `/admin/categories/${hour?.id ?? ''}`, adminCookie, {
      weekdayRateCents: 10000,
    });

    expect(adminCategorySchema.parse(res.body)).toMatchObject({
      weekdayRateCents: 10000,
      version: 2,
      averageHourlyCents: 10000,
    });
    const [entry] = await db.select().from(auditLog).where(eq(auditLog.action, 'category.update'));
    const rate = (v: unknown) => (v as { weekdayRateCents: number }).weekdayRateCents;
    expect([rate(entry?.before), rate(entry?.after)]).toEqual([9700, 10000]);
    const [segment] = await db
      .select()
      .from(bookingSegments)
      .where(eq(bookingSegments.bookingId, booking.id));
    expect([segment?.rateCentsPerHour, segment?.amountCents]).toEqual([9700, 9700]);
  });

  it('keeps the version when only the name changes', async () => {
    const hour = await byName('1 hora');

    const res = await call('PATCH', `/admin/categories/${hour?.id ?? ''}`, adminCookie, {
      name: '1 hora avulsa',
    });

    expect(adminCategorySchema.parse(res.body)).toMatchObject({
      name: '1 hora avulsa',
      version: 1,
    });
  });

  it('rejects deactivating the reference category with the documented message', async () => {
    const reference = (await list()).find((c) => c.isReference);

    const res = await call('PATCH', `/admin/categories/${reference?.id ?? ''}`, adminCookie, {
      status: 'inactive',
    });

    expect([res.status, res.error?.code]).toEqual([422, 'VALIDATION_FAILED']);
    expect(res.error?.details).toEqual([
      { path: 'status', message: 'Defina outra categoria de referência antes de desativar esta.' },
    ]);
    expect((await byName('1 hora'))?.status).toBe('active');
  });
});

describe('POST /admin/categories/:id/reference (NUC-66)', () => {
  it('moves the reference flag atomically and audits category.set_reference', async () => {
    const target = await byName('2 horas ou mais');

    const res = await call('POST', `/admin/categories/${target?.id ?? ''}/reference`, adminCookie);

    expect(adminCategorySchema.parse(res.body)).toMatchObject({
      name: '2 horas ou mais',
      isReference: true,
    });
    expect((await list()).filter((c) => c.isReference).map((c) => c.name)).toEqual([
      '2 horas ou mais',
    ]);
    expect(await actions()).toEqual(['category.set_reference']);
  });

  it('rejects a non-hourly category with 422', async () => {
    const pack = await byName('Pacote 20h mensal');

    const res = await call('POST', `/admin/categories/${pack?.id ?? ''}/reference`, adminCookie);

    expect([res.status, res.error?.code]).toEqual([422, 'VALIDATION_FAILED']);
    expect((await byName('1 hora'))?.isReference).toBe(true);
  });
});

describe('POST /admin/categories/reorder (NUC-68)', () => {
  it('sets display orders 1..n in the given order', async () => {
    const ids = (await list()).map((c) => c.id).reverse();

    const res = await call('POST', '/admin/categories/reorder', adminCookie, { ids });

    expect(res.status).toBe(200);
    const items = (res.body as { items: { id: string; displayOrder: number }[] }).items;
    expect(items.map((c) => [c.id, c.displayOrder])).toEqual(ids.map((id, i) => [id, i + 1]));
  });

  it('rejects a list with a missing id with 422 and changes nothing', async () => {
    const before = (await list()).map((c) => c.id);

    const res = await call('POST', '/admin/categories/reorder', adminCookie, {
      ids: before.slice(1),
    });

    expect([res.status, res.error?.code]).toEqual([422, 'VALIDATION_FAILED']);
    expect((await list()).map((c) => c.id)).toEqual(before);
  });
});

describe('POST /admin/onboarding/prices-reviewed (NUC-69)', () => {
  it('sets onboarding.prices_reviewed and audits onboarding.prices_reviewed', async () => {
    const res = await call('POST', '/admin/onboarding/prices-reviewed', adminCookie);

    expect(pricesReviewedSchema.parse(res.body)).toEqual({ pricesReviewed: true });
    const [row] = await db
      .select()
      .from(settings)
      .where(eq(settings.key, 'onboarding.prices_reviewed'));
    expect(row?.value).toBe(true);
    expect(await actions()).toEqual(['onboarding.prices_reviewed']);
  });
});
