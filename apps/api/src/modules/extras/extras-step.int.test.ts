import { randomUUID } from 'node:crypto';
import { quoteSchema } from '@bravo/core';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTenant } from '../../../test/booking-helpers';
import { forbiddenFetch, send, testEnv } from '../../../test/http';
import { requireTestDatabaseUrl } from '../../../test/require-test-db';
import { createApp } from '../../app';
import { createDb, withTransaction } from '../../db/client';
import { bookingExtraItems, bookings, extraServices } from '../../db/schema';
import { runSeed } from '../../db/seed';
import { buildRegistry } from '../../extensions';
import { saveSetting } from '../settings/settings.repo';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

// Tuesday 2027-03-02 12:00 BRT; the booking is the next Tuesday 14:00–16:00 = 2 h × R$ 80,00.
const NOW = new Date('2027-03-02T15:00:00.000Z');
const SLOT = { roomSlug: 'principal', date: '2027-03-09', startMinute: 840, endMinute: 960 };

const app = () =>
  createApp({
    db,
    now: () => NOW,
    fetch: forbiddenFetch,
    env: testEnv(),
    registry: buildRegistry(),
  });

beforeEach(async () => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  await runSeed(db);
  await withTransaction(db, (tx) => saveSetting(tx, 'onboarding.prices_reviewed', true, null));
});

async function service(values: Partial<typeof extraServices.$inferInsert>) {
  const [row] = await db
    .insert(extraServices)
    .values({
      name: 'Filmagem',
      referencePriceCents: 8000,
      unit: 'hour',
      saleMode: 'online',
      ...values,
    })
    .returning();
  return row!;
}

const quote = (cookie: string, extras: unknown) =>
  send(app(), 'POST', '/public/bookings/quote', {
    cookie,
    body: { ...SLOT, addons: { extras } },
  });

const book = (cookie: string, extras: unknown, expectedTotalCents: number) =>
  send(app(), 'POST', '/app/bookings', {
    cookie,
    body: {
      ...SLOT,
      addons: { extras },
      acceptPolicy: true,
      policyVersion: 1,
      expectedTotalCents,
    },
    headers: { 'Idempotency-Key': randomUUID() },
  });

describe('checkout add-on extras (GES-88)', () => {
  it('adds 8000/h × 2 to a 2 h booking: total 32000, deposit on the new total, frozen items', async () => {
    const filming = await service({ name: 'Filmagem' });
    const { cookie } = await createTenant(db, { now: NOW });

    const priced = await quote(cookie, [{ serviceId: filming.id, quantity: 2 }]);
    expect(priced.status).toBe(200);
    const q = quoteSchema.parse(priced.body);
    expect([q.grossCents, q.extrasCents, q.netCents]).toEqual([16_000, 16_000, 32_000]);
    expect([q.payment.mode, q.payment.depositCents, q.payment.balanceCents]).toEqual([
      'deposit_balance',
      16_000,
      16_000,
    ]);
    // Intl writes "R$" with a no-break space.
    const extraLines = q.lines
      .filter((l) => l.kind === 'extra')
      .map((l) => ({ ...l, label: l.label.replaceAll(' ', ' ') }));
    expect(extraLines).toEqual([
      { kind: 'extra', label: 'Filmagem · 2h × R$ 80,00', amountCents: 16_000 },
    ]);

    const created = await book(cookie, [{ serviceId: filming.id, quantity: 2 }], 32_000);
    expect(created.status).toBe(201);
    const id = (created.body as { id: string }).id;
    const [booking] = await db.select().from(bookings).where(eq(bookings.id, id));
    expect(booking).toMatchObject({ grossCents: 16_000, totalCents: 32_000, depositCents: 16_000 });

    // The catalog changes afterwards; the sold line keeps its name, unit and price.
    await db
      .update(extraServices)
      .set({ name: 'Filmagem 4K', referencePriceCents: 12_000 })
      .where(eq(extraServices.id, filming.id));
    const items = await db
      .select()
      .from(bookingExtraItems)
      .where(eq(bookingExtraItems.bookingId, id));
    expect(items).toEqual([
      expect.objectContaining({
        serviceId: filming.id,
        serviceName: 'Filmagem',
        unit: 'hour',
        quantity: 2,
        unitPriceCents: 8000,
        amountCents: 16_000,
      }),
    ]);
  });

  it('prices a project service at quantity 1 together with an hourly one', async () => {
    const filming = await service({ name: 'Filmagem' });
    const edit = await service({ name: 'Edição', unit: 'project', referencePriceCents: 30_000 });
    const { cookie } = await createTenant(db, { now: NOW });

    const res = await quote(cookie, [
      { serviceId: filming.id, quantity: 1 },
      { serviceId: edit.id, quantity: 1 },
    ]);

    const q = quoteSchema.parse(res.body);
    expect([q.extrasCents, q.netCents, q.payment.depositCents]).toEqual([38_000, 54_000, 27_000]);
    expect(q.extensions['extras']).toEqual([
      expect.objectContaining({ serviceId: filming.id, quantity: 1, amountCents: 8000 }),
      expect.objectContaining({ serviceId: edit.id, unit: 'project', amountCents: 30_000 }),
    ]);
  });
});

describe('checkout add-on rejections (GES-89)', () => {
  it('answers 422 on serviceId for an inactive or quote-mode service, and books nothing', async () => {
    const inactive = await service({ status: 'inactive' });
    const quoteOnly = await service({ saleMode: 'quote' });
    const { cookie } = await createTenant(db, { now: NOW });

    for (const target of [inactive, quoteOnly]) {
      const priced = await quote(cookie, [{ serviceId: target.id, quantity: 1 }]);
      const created = await book(cookie, [{ serviceId: target.id, quantity: 1 }], 24_000);
      for (const res of [priced, created]) {
        expect(res.status).toBe(422);
        expect(res.error?.code).toBe('VALIDATION_FAILED');
        expect(res.error?.details).toEqual([
          { path: 'addons.extras.0.serviceId', message: 'Serviço indisponível para compra online' },
        ]);
      }
    }
    expect(await db.select().from(bookings)).toHaveLength(0);
    expect(await db.select().from(bookingExtraItems)).toHaveLength(0);
  });

  it('answers 422 on quantity for 3 hours on a 2 h booking and for a project quantity ≠ 1', async () => {
    const filming = await service({ unit: 'hour' });
    const edit = await service({ name: 'Edição', unit: 'project', referencePriceCents: 30_000 });
    const { cookie } = await createTenant(db, { now: NOW });

    const tooManyHours = await quote(cookie, [{ serviceId: filming.id, quantity: 3 }]);
    const twoProjects = await book(cookie, [{ serviceId: edit.id, quantity: 2 }], 76_000);
    const zero = await quote(cookie, [{ serviceId: filming.id, quantity: 0 }]);

    expect([tooManyHours.status, tooManyHours.error?.details]).toEqual([
      422,
      [{ path: 'addons.extras.0.quantity', message: 'Escolha de 1 a 2 horas' }],
    ]);
    expect([twoProjects.status, twoProjects.error?.details]).toEqual([
      422,
      [
        {
          path: 'addons.extras.0.quantity',
          message: 'Este serviço é vendido por projeto (quantidade 1)',
        },
      ],
    ]);
    expect([zero.status, zero.error?.details?.[0]?.path]).toEqual([
      422,
      'addons.extras.0.quantity',
    ]);
    expect(await db.select().from(bookings)).toHaveLength(0);
  });

  it('answers 422 when extras come with payment by package minutes', async () => {
    const filming = await service({});
    const { cookie } = await createTenant(db, { now: NOW });

    const res = await send(app(), 'POST', '/public/bookings/quote', {
      cookie,
      body: {
        ...SLOT,
        payWith: 'package',
        addons: { extras: [{ serviceId: filming.id, quantity: 1 }] },
      },
    });

    expect([res.status, res.error?.details?.[0]?.path]).toEqual([422, 'addons.extras']);
  });
});
