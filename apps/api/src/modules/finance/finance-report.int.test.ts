import { randomUUID } from 'node:crypto';
import { localToUtc, REVENUE_CATEGORIES } from '@bravo/core';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStaff, createTenant, seededRoom } from '../../../test/booking-helpers';
import { createBooking as insertBooking } from '../../../test/factories';
import {
  seedFinanceFacts as seedFacts,
  financeTotals as totals,
} from '../../../test/factories/finance';
import { forbiddenFetch, send, testEnv } from '../../../test/http';
import { connectMcp } from '../../../test/mcp-client';
import { requireTestDatabaseUrl } from '../../../test/require-test-db';
import { createApp } from '../../app';
import { createDb, withTransaction } from '../../db/client';
import { charges } from '../../db/schema';
import { runSeed } from '../../db/seed';
import { saveSetting } from '../settings/settings.repo';

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
const summary = (cookie: string, query: string) =>
  send(buildApp(), 'GET', `/admin/finance/summary?${query}`, { cookie });

type Totals = ReturnType<typeof totals>;

interface Summary {
  buckets: ({ key: string; label: string; from: string; to: string } & Totals)[];
  totals: Totals;
  previous: { from: string; to: string } & Totals;
  comparison: Record<string, { deltaCents: number; deltaPercent: number | null }>;
  byRevenueCategory: Record<string, number>;
  byExpenseCategory: { id: string; name: string; cents: number }[];
}

describe('GET /admin/finance/summary (GES-22, GES-24)', () => {
  it('buckets the worked examples by month in Caixa', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const { categoryA, categoryB } = await seedFacts(db, NOW);

    const res = await summary(
      admin.cookie,
      'from=2026-10-01&to=2026-12-31&grouping=month&regime=cash',
    );

    expect(res.status).toBe(200);
    const body = res.body as Summary;
    expect(body.buckets.map(({ key, label, from, to }) => ({ key, label, from, to }))).toEqual([
      { key: '2026-10', label: 'out/2026', from: '2026-10-01', to: '2026-10-31' },
      { key: '2026-11', label: 'nov/2026', from: '2026-11-01', to: '2026-11-30' },
      { key: '2026-12', label: 'dez/2026', from: '2026-12-01', to: '2026-12-31' },
    ]);
    expect(body.buckets[0]).toMatchObject(totals(616_000, 0, 0, 0, 0));
    expect(body.buckets[1]).toMatchObject(totals(112_900, -2_000, -8_000, -608, -10_000));
    expect(body.buckets[2]).toMatchObject(totals(0, 0, 0, 0, -3_000));
    expect(body.totals).toEqual(totals(728_900, -2_000, -8_000, -608, -13_000));
    expect(body.byRevenueCategory).toEqual({
      rental_single: 59_900,
      subscription_initial: 616_000,
      subscription_renewal: 0,
      extra_hours: 40_000,
      extra_services: 8_000,
      other: 5_000,
    });
    expect(body.byExpenseCategory).toEqual([
      { id: categoryA?.id, name: categoryA?.name, cents: -10_000 },
      { id: categoryB?.id, name: categoryB?.name, cents: -3_000 },
    ]);
  });

  it('buckets the same facts by usage in Competência (period spread, cancellation date)', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    await seedFacts(db, NOW);

    const res = await summary(
      admin.cookie,
      'from=2026-10-01&to=2026-12-31&grouping=month&regime=accrual',
    );

    const body = res.body as Summary;
    expect(body.buckets[0]).toMatchObject(totals(0, 0, 0, 0, 0));
    // Period: Nov 2..30 = 10 × 20534 + 19 × 20533; Dec 1 = 20533.
    expect(body.buckets[1]).toMatchObject(totals(686_467, 0, -8_000, -400, -10_000));
    expect(body.buckets[2]).toMatchObject(totals(42_433, -2_000, 0, -208, -3_000));
    expect(body.totals).toEqual(totals(728_900, -2_000, -8_000, -608, -13_000));
  });

  it('returns the previous range of equal length with absolute and one-decimal percent deltas', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    await seedFacts(db, NOW);

    const res = await summary(admin.cookie, 'from=2026-11-01&to=2026-11-30&regime=cash');

    const body = res.body as Summary;
    expect(body.previous).toEqual({
      from: '2026-10-02',
      to: '2026-10-31',
      ...totals(616_000, 0, 0, 0, 0),
    });
    expect(body.comparison.grossCents).toEqual({ deltaCents: -503_100, deltaPercent: -81.7 });
    expect(body.comparison.netCents).toEqual({ deltaCents: -513_708, deltaPercent: -83.4 });
    expect(body.comparison.expensesCents).toEqual({ deltaCents: -10_000, deltaPercent: null });
  });

  it('counts credit used as payment on lines 1 and 2, and nothing for package-paid bookings', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const { user } = await createTenant(db, { now: NOW });
    const room = await seededRoom(db);
    const booking = (mode: string, minute: number) =>
      insertBooking(db, {
        userId: user.id,
        roomId: room.id,
        startsAt: localToUtc('2027-01-20', minute),
        endsAt: localToUtc('2027-01-20', minute + 60),
        status: 'paid',
        totalCents: 10_000,
        paymentMode: mode,
        occupancy: false,
      });
    const paid = await booking('full_upfront', 600);
    const byPackage = await booking('package', 720);
    const charge = (bookingId: string, method: string, provider: string, amountCents: number) =>
      db.insert(charges).values({
        provider,
        purpose: 'booking_full',
        method,
        userId: user.id,
        bookingId,
        amountCents,
        feeCents: method === 'credit' ? 0 : 60,
        status: 'approved',
        approvedAt: localToUtc('2027-01-10', 720),
        idempotencyKey: `ch_${randomUUID()}`,
      });
    await charge(paid.id, 'credit', 'internal', 4_000);
    await charge(paid.id, 'pix', 'sandbox', 6_000);
    await charge(byPackage.id, 'pix', 'sandbox', 5_000);

    const res = await summary(admin.cookie, 'from=2027-01-01&to=2027-01-31&regime=cash');

    expect((res.body as Summary).totals).toEqual(totals(10_000, -4_000, 0, -60, 0));
  });

  it('answers zeros and null percents for an empty range, with ISO weeks clipped to it', async () => {
    const admin = await createStaff(db, 'admin', NOW);

    const res = await summary(
      admin.cookie,
      'from=2027-02-01&to=2027-02-28&grouping=week&regime=cash',
    );

    expect(res.status).toBe(200);
    const body = res.body as Summary;
    expect(body.buckets.map((b) => [b.from, b.to])).toEqual([
      ['2027-02-01', '2027-02-07'],
      ['2027-02-08', '2027-02-14'],
      ['2027-02-15', '2027-02-21'],
      ['2027-02-22', '2027-02-28'],
    ]);
    expect(body.totals).toEqual(totals(0, 0, 0, 0, 0));
    expect(Object.values(body.comparison)).toEqual(
      Array.from({ length: 7 }, () => ({ deltaCents: 0, deltaPercent: null })),
    );
    expect(body.byRevenueCategory).toEqual(
      Object.fromEntries(REVENUE_CATEGORIES.map((c) => [c, 0])),
    );
    expect(body.byExpenseCategory).toEqual([]);
  });

  it('answers 422 for a range over 731 days or reversed, and 403 to reception', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const reception = await createStaff(db, 'reception', NOW);

    const tooLong = await summary(admin.cookie, 'from=2025-01-01&to=2027-01-02');
    const longest = await summary(admin.cookie, 'from=2025-01-01&to=2027-01-01');
    const reversed = await summary(admin.cookie, 'from=2027-01-02&to=2027-01-01');
    const forbidden = await summary(reception.cookie, 'from=2027-01-01&to=2027-01-31');

    expect([tooLong.status, tooLong.error?.code, tooLong.error?.details?.[0]?.path]).toEqual([
      422,
      'VALIDATION_FAILED',
      'to',
    ]);
    expect(longest.status).toBe(200);
    expect(reversed.status).toBe(422);
    expect([forbidden.status, forbidden.error?.code]).toEqual([403, 'FORBIDDEN']);
  });

  it('finance_summary through MCP answers the same totals', async () => {
    await withTransaction(db, (tx) => saveSetting(tx, 'mcp.enabled', true, null));
    const admin = await createStaff(db, 'admin', NOW);
    await seedFacts(db, NOW);
    const { token } = (
      await send(buildApp(), 'POST', '/admin/integrations/mcp/tokens', {
        cookie: admin.cookie,
        body: { name: 'Leitura', scope: 'read' },
      })
    ).body as { token: string };
    const client = await connectMcp(buildApp(), token);

    const result = await client.callTool({
      name: 'finance_summary',
      arguments: { from: '2026-10-01', to: '2026-12-31', grouping: 'month', regime: 'accrual' },
    });
    await client.close();

    expect(result.isError).toBeFalsy();
    expect((result.structuredContent as Summary).totals).toEqual(
      totals(728_900, -2_000, -8_000, -608, -13_000),
    );
  });
});
