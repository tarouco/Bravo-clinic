import { randomUUID } from 'node:crypto';
import { and, eq, like } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTenant, seededRoom } from '../../test/booking-helpers';
import { createCreditLot, createSubscription } from '../../test/factories/revenue';
import { forbiddenFetch, testEnv } from '../../test/http';
import { requireTestDatabaseUrl } from '../../test/require-test-db';
import { createDb, withTransaction } from '../db/client';
import {
  bookingCategories,
  charges,
  emailOutbox,
  paymentCustomers,
  savedCards,
  subscriptionPeriods,
  subscriptions,
} from '../db/schema';
import { runSeed } from '../db/seed';
import { buildRegistry } from '../extensions';
import { newAfterCommit } from '../modules/booking/effects';
import { SANDBOX_DECLINED_LAST4 } from '../payments/adapters/sandbox';
import { activatePeriod } from '../modules/subscriptions/period.service';
import { renewals } from './renewals';
import { JOB_CONTEXT } from './runner';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

// 2026-11-30 03:00 BRT: the renewal of a period starting 2026-12-02 is due.
const DUE = new Date('2026-11-30T06:00:00.000Z');
const NEXT_DAY = new Date('2026-12-01T06:00:00.000Z');
const NOW = new Date('2026-10-26T12:00:00.000Z');
const deps = () => ({
  db,
  env: testEnv(),
  fetch: forbiddenFetch,
  now: () => NOW,
  registry: buildRegistry(),
});
const run = (now: Date) => renewals({ ...deps(), now: () => now }, now);

beforeEach(async () => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  await runSeed(db);
});

const seeded = async (name: string) => {
  const [row] = await db.select().from(bookingCategories).where(eq(bookingCategories.name, name));
  if (row === undefined) throw new Error(`no seeded category ${name}`);
  return row;
};

/** Pacote 20h with base 2026-11-02, first period active and paid with a coupon discount. */
async function hourPackage(opts: { card?: 'ok' | 'declined' | 'deleted' } = {}) {
  const { user } = await createTenant(db, { now: NOW });
  const category = await seeded('Pacote 20h mensal');
  let savedCardId: string | null = null;
  if (opts.card !== undefined) {
    await db
      .insert(paymentCustomers)
      .values({ userId: user.id, provider: 'sandbox', externalCustomerId: `cus_${user.id}` });
    const last4 = opts.card === 'declined' ? SANDBOX_DECLINED_LAST4 : '4242';
    const [card] = await db
      .insert(savedCards)
      .values({
        userId: user.id,
        provider: 'sandbox',
        externalCardId: `sbx_card_${last4}_${randomUUID()}`,
        last4,
        recurringConsentAt: NOW,
        deletedAt: opts.card === 'deleted' ? NOW : null,
      })
      .returning();
    savedCardId = card?.id ?? null;
  }
  const { subscription, period } = await createSubscription(db, {
    userId: user.id,
    category,
    paymentMethod: opts.card === undefined ? 'pix' : 'saved_card',
    period: { status: 'active', minutesBalance: 600 },
  });
  await db.update(subscriptions).set({ savedCardId }).where(eq(subscriptions.id, subscription.id));
  await db
    .update(subscriptionPeriods)
    .set({ discountCents: 16_000 })
    .where(eq(subscriptionPeriods.id, period?.id ?? ''));
  return { user, category, subscription, period };
}

const periodsOf = (subscriptionId: string) =>
  db
    .select()
    .from(subscriptionPeriods)
    .where(eq(subscriptionPeriods.subscriptionId, subscriptionId))
    .orderBy(subscriptionPeriods.seq);
const chargesOf = (periodId: string) =>
  db
    .select()
    .from(charges)
    .where(eq(charges.subscriptionPeriodId, periodId))
    .orderBy(charges.createdAt, charges.id);
const outbox = (prefix: string) =>
  db
    .select()
    .from(emailOutbox)
    .where(like(emailOutbox.dedupeKey, `${prefix}%`));

describe('renewals job (REC-47, REC-48, REC-125)', () => {
  it('2026-11-30: seq 2 awaiting at 160000 without the coupon and one Pix charge; a re-run creates nothing', async () => {
    const { subscription } = await hourPackage();
    const stats = await run(DUE);
    expect(stats).toMatchObject({ renewalsCreated: 1, charges: 1 });
    const [, next] = await periodsOf(subscription.id);
    expect(next).toMatchObject({
      seq: 2,
      status: 'awaiting_payment',
      startsOn: '2026-12-02',
      priceCents: 160_000,
      discountCents: 0,
      renewalAttempts: 1,
    });
    const list = await chargesOf(next?.id ?? '');
    expect(list.map((c) => [c.purpose, c.method, c.amountCents, c.idempotencyKey])).toEqual([
      ['subscription_renewal', 'pix', 160_000, `renewal:${next?.id ?? ''}:1`],
    ]);
    const mails = await outbox(`renewal_charge:${next?.id ?? ''}:1`);
    expect(mails).toHaveLength(1);
    expect(mails[0]?.textBody).toContain(`Pix copia e cola: ${list[0]?.pixCopyPaste ?? 'x'}`);
    expect(mails[0]?.textBody).toContain('02/12/2026');

    expect(await run(DUE)).toMatchObject({ renewalsCreated: 0, charges: 0 });
    expect(await periodsOf(subscription.id)).toHaveLength(2);
    expect(await chargesOf(next?.id ?? '')).toHaveLength(1);
  });

  it('is not due before 2026-11-30 03:00 BRT', async () => {
    const { subscription } = await hourPackage();
    await run(new Date('2026-11-30T02:59:00.000Z'));
    expect(await periodsOf(subscription.id)).toHaveLength(1);
  });

  it('a declined saved card is retried once the next day, never on starts_on (REC-50)', async () => {
    const { subscription } = await hourPackage({ card: 'declined' });
    await run(DUE);
    const [, next] = await periodsOf(subscription.id);
    const first = await chargesOf(next?.id ?? '');
    expect(first.map((c) => [c.method, c.status])).toEqual([['saved_card', 'rejected']]);
    expect(await outbox(`renewal_failed:${next?.id ?? ''}`)).toHaveLength(1);
    expect(await run(DUE)).toMatchObject({ retries: 0 });
    expect(await run(NEXT_DAY)).toMatchObject({ retries: 1 });
    expect((await chargesOf(next?.id ?? '')).map((c) => c.idempotencyKey)).toEqual([
      `renewal:${next?.id ?? ''}:1`,
      `renewal:${next?.id ?? ''}:2`,
    ]);
    await run(new Date('2026-12-02T06:00:00.000Z'));
    expect(await chargesOf(next?.id ?? '')).toHaveLength(2);
  });

  it('an approved saved card pays the renewal at once: period paid', async () => {
    const { subscription } = await hourPackage({ card: 'ok' });
    await run(DUE);
    const [, next] = await periodsOf(subscription.id);
    expect(next?.status).toBe('paid');
    expect((await chargesOf(next?.id ?? ''))[0]).toMatchObject({
      method: 'saved_card',
      status: 'approved',
    });
  });

  it('a deleted card falls back to Pix and asks for a new card (REC-52)', async () => {
    const { subscription } = await hourPackage({ card: 'deleted' });
    await run(DUE);
    const [, next] = await periodsOf(subscription.id);
    expect((await chargesOf(next?.id ?? '')).map((c) => c.method)).toEqual(['pix']);
    const [mail] = await outbox(`renewal_charge:${next?.id ?? ''}:1`);
    expect(mail?.textBody).toContain('Cadastre um cartão para as próximas renovações.');
  });

  it('credits of 50000 reduce the charge to 110000 (REC-115)', async () => {
    const { user, subscription } = await hourPackage();
    await createCreditLot(db, { userId: user.id, amountCents: 50_000 });
    await run(DUE);
    const [, next] = await periodsOf(subscription.id);
    expect((await chargesOf(next?.id ?? '')).map((c) => [c.method, c.amountCents]).sort()).toEqual([
      ['credit', 50_000],
      ['pix', 110_000],
    ]);
  });

  it('credits covering the renewal settle it without a gateway charge', async () => {
    const { user, subscription } = await hourPackage();
    await createCreditLot(db, { userId: user.id, amountCents: 200_000 });
    await run(DUE);
    const [, next] = await periodsOf(subscription.id);
    expect(next?.status).toBe('paid');
    expect((await chargesOf(next?.id ?? '')).map((c) => c.method)).toEqual(['credit']);
  });

  it('an inactive category still renews (REC-09)', async () => {
    const { subscription, category } = await hourPackage();
    await db
      .update(bookingCategories)
      .set({ status: 'inactive' })
      .where(eq(bookingCategories.id, category.id));
    await run(DUE);
    expect(await periodsOf(subscription.id)).toHaveLength(2);
  });

  it('an admin_only category still renews (REC-09)', async () => {
    const { subscription, category } = await hourPackage();
    await db
      .update(bookingCategories)
      .set({ visibility: 'admin_only' })
      .where(eq(bookingCategories.id, category.id));
    await run(DUE);
    const [, next] = await periodsOf(subscription.id);
    expect(next).toMatchObject({ seq: 2, status: 'awaiting_payment' });
    expect(await chargesOf(next?.id ?? '')).toHaveLength(1);
  });

  it('fixed schedule: promotes the held period priced per occurrence × held count (REC-93)', async () => {
    const { user } = await createTenant(db, { now: NOW });
    const category = await seeded('Meio turno mensal');
    const room = await seededRoom(db);
    const { subscription, period } = await createSubscription(db, {
      userId: user.id,
      category,
      roomId: room.id,
      period: { status: 'paid' },
    });
    await withTransaction(db, (tx) =>
      activatePeriod(tx, JOB_CONTEXT, period?.id ?? '', {
        now: NOW,
        appBaseUrl: 'http://localhost:5173',
        fx: newAfterCommit(),
      }),
    );
    await run(DUE);
    const [, next] = await periodsOf(subscription.id);
    expect(next).toMatchObject({ status: 'awaiting_payment', priceCents: 22 * 28_000 });
    expect((await chargesOf(next?.id ?? '')).map((c) => c.amountCents)).toEqual([616_000]);
  }, 240_000);
});

describe('reminders and notices (REC-51, REC-58)', () => {
  it('one Pix reminder per day while pending, none on the charge day', async () => {
    const { subscription } = await hourPackage();
    await run(DUE);
    const [, next] = await periodsOf(subscription.id);
    expect(await outbox(`renewal_reminder:${next?.id ?? ''}`)).toHaveLength(0);
    await run(NEXT_DAY);
    await run(NEXT_DAY);
    const reminders = await outbox(`renewal_reminder:${next?.id ?? ''}`);
    expect(reminders.map((r) => r.dedupeKey)).toEqual([
      `renewal_reminder:${next?.id ?? ''}:2026-12-01`,
    ]);
  });

  it('period-ending e-mails on 2026-11-25 and 2026-12-01', async () => {
    const { period } = await hourPackage();
    await run(new Date('2026-11-24T06:00:00.000Z'));
    expect(await outbox(`period_ending:${period?.id ?? ''}`)).toHaveLength(0);
    await run(new Date('2026-11-25T06:00:00.000Z'));
    await run(NEXT_DAY);
    const notices = await db
      .select({ key: emailOutbox.dedupeKey, text: emailOutbox.textBody })
      .from(emailOutbox)
      .where(and(like(emailOutbox.dedupeKey, `period_ending:${period?.id ?? ''}%`)));
    expect(notices.map((n) => n.key).sort()).toEqual([
      `period_ending:${period?.id ?? ''}:1`,
      `period_ending:${period?.id ?? ''}:7`,
    ]);
    expect(notices[0]?.text).toContain('10h');
  });
});
