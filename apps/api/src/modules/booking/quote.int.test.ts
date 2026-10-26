import { localToUtc, quoteSchema, type LocalDate } from '@bravo/core';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createBooking, createCategory, createUser, loginAs } from '../../../test/factories';
import { forbiddenFetch, send, testEnv, type Sent } from '../../../test/http';
import { requireTestDatabaseUrl } from '../../../test/require-test-db';
import { createApp } from '../../app';
import { createDb } from '../../db/client';
import {
  bookingCategories,
  bookingSegments,
  bookings,
  charges,
  rateLimitBuckets,
  rooms,
} from '../../db/schema';
import { runSeed } from '../../db/seed';
import { createRegistry, type CheckoutStep } from '../../extensions/registry';
import { rateLimitKey } from '../../middleware/rate-limit';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

const NOW = new Date('2026-10-20T12:00:00Z');
const TUESDAY = '2026-10-27' as LocalDate;
const NBSP = ' ';

let roomId = '';

beforeEach(async () => {
  await runSeed(db);
  const [room] = await db.select().from(rooms).where(eq(rooms.slug, 'principal'));
  roomId = room?.id ?? '';
});

const buildApp = (registry = createRegistry()) =>
  createApp({ db, now: () => NOW, fetch: forbiddenFetch, env: testEnv(), registry });

const quote = (
  body: Record<string, unknown>,
  opts: { registry?: ReturnType<typeof createRegistry>; cookie?: string } = {},
): Promise<Sent> =>
  send(buildApp(opts.registry), 'POST', '/public/bookings/quote', {
    body: { roomSlug: 'principal', date: TUESDAY, ...body },
    ...(opts.cookie !== undefined && { cookie: opts.cookie }),
  });

const details = (res: Sent) => res.error?.details as unknown as Record<string, unknown>;

describe('POST /public/bookings/quote pricing and split (NUC-86)', () => {
  it('prices PR-3 as two segment lines totalling 21900 with the SP-1 sinal and no rows written', async () => {
    const res = await quote({ startMinute: 1050, endMinute: 1200 });

    expect(res.status).toBe(200);
    const parsed = quoteSchema.parse(res.body);
    expect(
      parsed.segments.map((s) => [s.startMinute, s.endMinute, s.categoryName, s.amountCents]),
    ).toEqual([
      [1050, 1140, '2 horas ou mais', 12000],
      [1140, 1200, '2 horas ou mais — noite', 9900],
    ]);
    expect([
      parsed.grossCents,
      parsed.netCents,
      parsed.discount.source,
      parsed.extrasCents,
    ]).toEqual([21900, 21900, 'none', 0]);
    expect(parsed.payment).toEqual({
      mode: 'deposit_balance',
      depositCents: 10950,
      balanceCents: 10950,
      payNowCents: 10950,
      creditUsedCents: 0,
      balanceChargeAt: '2026-10-25T20:30:00.000Z',
      balanceDueAt: '2026-10-26T20:30:00.000Z',
    });
    expect([parsed.policyVersion, parsed.holdMinutes]).toEqual([1, 15]);
    expect(parsed.lines.map((l) => [l.kind, l.label, l.amountCents])).toEqual([
      ['segment', `17:30–19:00 · 2 horas ou mais · 1h30 × R$${NBSP}80,00 = R$${NBSP}120,00`, 12000],
      [
        'segment',
        `19:00–20:00 · 2 horas ou mais — noite · 1h × R$${NBSP}99,00 = R$${NBSP}99,00`,
        9900,
      ],
      ['total', 'Total', 21900],
      ['deposit', 'Sinal (50%)', 10950],
      ['balance', 'Saldo', 10950],
    ]);
    expect(await db.select().from(bookings)).toEqual([]);
    expect(await db.select().from(bookingSegments)).toEqual([]);
    expect(await db.select().from(charges)).toEqual([]);
  });

  it('prices a block category at its fixed price as one segment', async () => {
    const block = await createCategory(db, {
      type: 'block',
      name: 'Manhã',
      startMinute: 420,
      endMinute: 720,
      fixedPriceCents: 28000,
    });

    const res = await quote({ startMinute: 420, endMinute: 720, blockCategoryId: block.id });

    const parsed = quoteSchema.parse(res.body);
    expect(parsed.blockCategoryId).toBe(block.id);
    expect(parsed.segments).toEqual([
      {
        startMinute: 420,
        endMinute: 720,
        minutes: 300,
        categoryId: block.id,
        categoryName: 'Manhã',
        dayType: 'weekday',
        rateCentsPerHour: null,
        amountCents: 28000,
      },
    ]);
    expect([parsed.grossCents, parsed.payment.depositCents]).toEqual([28000, 14000]);
  });
});

describe('POST /public/bookings/quote errors (NUC-87, NUC-88)', () => {
  it('rejects CL-1 with 422 SLOT_UNAVAILABLE, reason in_cleanup and "Sala em limpeza"', async () => {
    const user = await createUser(db);
    await createBooking(db, {
      userId: user.id,
      roomId,
      startsAt: localToUtc(TUESDAY, 540),
      endsAt: localToUtc(TUESDAY, 660),
    });

    const res = await quote({ startMinute: 660, endMinute: 720 });

    expect([res.status, res.error?.code, res.error?.message]).toEqual([
      422,
      'SLOT_UNAVAILABLE',
      'Sala em limpeza',
    ]);
    expect(details(res)).toEqual({ reason: 'in_cleanup' });
  });

  it('rejects PR-8 with 422 NO_CATEGORY and the uncovered range 19:00-20:00', async () => {
    await db
      .update(bookingCategories)
      .set({ status: 'inactive' })
      .where(eq(bookingCategories.name, '1 hora — noite'));

    const res = await quote({ startMinute: 1140, endMinute: 1200 });

    expect([res.status, res.error?.code]).toEqual([422, 'NO_CATEGORY']);
    expect(details(res)).toEqual({ uncovered: { startMinute: 1140, endMinute: 1200 } });
  });

  it('rejects a block quote whose interval differs from the block window with path startMinute', async () => {
    const block = await createCategory(db, {
      type: 'block',
      name: 'Manhã',
      startMinute: 420,
      endMinute: 720,
      fixedPriceCents: 28000,
    });

    const res = await quote({ startMinute: 480, endMinute: 720, blockCategoryId: block.id });

    expect([res.status, res.error?.code]).toEqual([422, 'VALIDATION_FAILED']);
    expect((res.error?.details as { path: string }[])[0]?.path).toBe('startMinute');
  });

  it('rejects an end before the start with 422 VALIDATION_FAILED and an unknown room with 404', async () => {
    const reversed = await quote({ startMinute: 720, endMinute: 660 });
    const unknown = await quote({ roomSlug: 'sala-inexistente', startMinute: 600, endMinute: 660 });

    expect([reversed.status, reversed.error?.code]).toEqual([422, 'VALIDATION_FAILED']);
    expect([unknown.status, unknown.error?.code]).toEqual([404, 'NOT_FOUND']);
  });
});

describe('quote pipeline steps (NUC-104)', () => {
  const trace: string[] = [];
  const stepOf = (name: string, order: number, apply: CheckoutStep['apply']): CheckoutStep => ({
    name,
    order,
    apply,
  });

  it('runs two registered steps in ascending order before the split', async () => {
    trace.length = 0;
    const registry = createRegistry({
      checkoutSteps: [
        stepOf('credit', 400, (_ctx, draft) => {
          trace.push(`400 sees discount ${String(draft.discount.cents)}`);
          return Promise.resolve(draft);
        }),
        stepOf('discount', 100, (_ctx, draft) => {
          trace.push('100');
          return Promise.resolve({
            ...draft,
            discount: { source: 'coupon', cents: 2000, label: 'Cupom TESTE' },
          });
        }),
      ],
    });

    const res = await quote({ startMinute: 840, endMinute: 1020 }, { registry });

    expect(trace).toEqual(['100', '400 sees discount 2000']);
    const parsed = quoteSchema.parse(res.body);
    expect([parsed.grossCents, parsed.discount, parsed.netCents]).toEqual([
      24000,
      { source: 'coupon', cents: 2000, label: 'Cupom TESTE' },
      22000,
    ]);
    expect(parsed.payment.depositCents).toBe(11000);
    expect(parsed.lines.find((l) => l.kind === 'discount')).toEqual({
      kind: 'discount',
      label: 'Cupom TESTE',
      amountCents: -2000,
    });
  });

  it('adds a fake extras step amount to the net, splits on it and passes extensions and addons untouched', async () => {
    const addons = { extras: [{ serviceId: 'svc-1', quantity: 2 }] };
    const seen: unknown[] = [];
    const registry = createRegistry({
      credits: {
        mode: 'live',
        availableCents: () => Promise.resolve(5000),
        grant: () => Promise.resolve({ creditLotId: null }),
      },
      checkoutSteps: [
        stepOf('extras', 300, (ctx, draft) => {
          seen.push(ctx.request.addons);
          return Promise.resolve({
            ...draft,
            extras: [{ label: 'Esterilização', amountCents: 16000 }],
            extensions: { ...draft.extensions, extras: { items: [{ id: 'svc-1', total: 16000 }] } },
          });
        }),
      ],
    });
    const user = await createUser(db);
    const cookie = await loginAs(db, user, { now: NOW });

    const res = await quote(
      { startMinute: 840, endMinute: 1020, addons, useCredits: true },
      { registry, cookie },
    );

    expect(seen).toEqual([addons]);
    const parsed = quoteSchema.parse(res.body);
    expect([parsed.grossCents, parsed.extrasCents, parsed.netCents]).toEqual([24000, 16000, 40000]);
    expect(parsed.extensions).toEqual({ extras: { items: [{ id: 'svc-1', total: 16000 }] } });
    expect(parsed.creditAvailableCents).toBe(5000);
    expect(parsed.payment).toMatchObject({
      depositCents: 20000,
      creditUsedCents: 5000,
      payNowCents: 15000,
      balanceCents: 20000,
    });
    expect(parsed.lines.map((l) => l.kind)).toEqual([
      'segment',
      'extra',
      'credit',
      'total',
      'deposit',
      'balance',
    ]);
  });

  it('gives steps the signed-in user and null for an anonymous visitor', async () => {
    const users: unknown[] = [];
    const registry = createRegistry({
      checkoutSteps: [
        stepOf('probe', 100, (ctx, draft) => {
          users.push(ctx.user);
          return Promise.resolve(draft);
        }),
      ],
    });
    const user = await createUser(db);
    const cookie = await loginAs(db, user, { now: NOW });

    await quote({ startMinute: 840, endMinute: 1020 }, { registry });
    await quote({ startMinute: 840, endMinute: 1020 }, { registry, cookie });

    expect(users).toEqual([null, { id: user.id, docNumber: null }]);
  });
});

describe('quote rate limit (NUC-81)', () => {
  it('answers the 121st request of a minute from one IP with 429 and Retry-After', async () => {
    await db.insert(rateLimitBuckets).values({
      key: rateLimitKey('public-calendar', '203.0.113.50'),
      windowStart: new Date('2026-10-20T12:00:00Z'),
      count: 119,
    });
    const app = buildApp();
    const request = () =>
      send(app, 'POST', '/public/bookings/quote', {
        body: { roomSlug: 'principal', date: TUESDAY, startMinute: 840, endMinute: 1020 },
        headers: { 'X-Forwarded-For': '203.0.113.50' },
      });

    const hundredTwentieth = await request();
    const hundredTwentyFirst = await request();

    expect(hundredTwentieth.status).toBe(200);
    expect([hundredTwentyFirst.status, hundredTwentyFirst.error?.code]).toEqual([
      429,
      'TOO_MANY_ATTEMPTS',
    ]);
    expect(hundredTwentyFirst.headers.get('Retry-After')).toBe('60');
  });
});
