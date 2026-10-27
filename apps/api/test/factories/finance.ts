import { randomUUID } from 'node:crypto';
import { localToUtc, type LocalDate } from '@bravo/core';
import { asc, eq } from 'drizzle-orm';
import type { Db } from '../../src/db/client';
import {
  bookingExtraItems,
  bookings,
  charges,
  expenseCategories,
  expenses,
  extraServices,
  manualReceipts,
  refunds,
} from '../../src/db/schema';
import { createTenant, seededRoom } from '../booking-helpers';
import { createBooking as insertBooking } from '../factories';
import { createFixedCategory, createSubscription } from './revenue';

// Finance report fixtures (gestao T18, T19): the design worked examples as database rows.

const noon = (date: LocalDate) => localToUtc(date, 720);

async function charge(
  db: Db,
  values: {
    userId: string;
    purpose: string;
    amountCents: number;
    approvedOn: LocalDate;
    feeCents?: number;
    bookingId?: string;
    subscriptionPeriodId?: string;
    status?: string;
  },
) {
  const [row] = await db
    .insert(charges)
    .values({
      provider: 'sandbox',
      externalId: `sbx_${randomUUID()}`,
      purpose: values.purpose,
      method: 'pix',
      userId: values.userId,
      bookingId: values.bookingId ?? null,
      subscriptionPeriodId: values.subscriptionPeriodId ?? null,
      amountCents: values.amountCents,
      feeCents: values.feeCents ?? 0,
      status: values.status ?? 'approved',
      approvedAt: noon(values.approvedOn),
      idempotencyKey: `ch_${randomUUID()}`,
    })
    .returning();
  if (row === undefined) throw new Error('charge insert returned no row');
  return row;
}

/**
 * The design worked examples in one dataset (Oct–Dec 2026):
 * B1 coupon booking on Dec 2 (deposit Nov 20 fee 109, balance Nov 30 fee 99), a fixed-schedule
 * period Nov 2..Dec 2 paid Oct 31, extra hours on Nov 15 (fee 400), B2 with 8000 of extras paid
 * in full on Nov 10, B3 cancelled by the tenant on Nov 10 with the balance refunded that day, a
 * manual receipt, two expenses and a deleted one.
 */
export async function seedFinanceFacts(db: Db, now: Date) {
  const { user } = await createTenant(db, { now });
  const room = await seededRoom(db);
  const [categoryA, categoryB] = await db
    .select()
    .from(expenseCategories)
    .orderBy(asc(expenseCategories.displayOrder));

  const b1 = await insertBooking(db, {
    userId: user.id,
    roomId: room.id,
    startsAt: localToUtc('2026-12-02', 840),
    endsAt: localToUtc('2026-12-02', 960),
    status: 'paid',
    totalCents: 19_900,
    paidCents: 19_900,
    occupancy: false,
  });
  await db
    .update(bookings)
    .set({ discountCents: 2_000, grossCents: 21_900 })
    .where(eq(bookings.id, b1.id));
  await charge(db, {
    userId: user.id,
    bookingId: b1.id,
    purpose: 'booking_deposit',
    amountCents: 9_950,
    approvedOn: '2026-11-20',
    feeCents: 109,
  });
  await charge(db, {
    userId: user.id,
    bookingId: b1.id,
    purpose: 'booking_balance',
    amountCents: 9_950,
    approvedOn: '2026-11-30',
    feeCents: 99,
  });

  const fixed = await createFixedCategory(db);
  const { period } = await createSubscription(db, {
    userId: user.id,
    category: fixed,
    roomId: room.id,
    baseOn: '2026-11-02',
    period: { startsOn: '2026-11-02', priceCents: 616_000 },
  });
  await charge(db, {
    userId: user.id,
    subscriptionPeriodId: period?.id ?? '',
    purpose: 'subscription_initial',
    amountCents: 616_000,
    approvedOn: '2026-10-31',
  });

  await charge(db, {
    userId: user.id,
    purpose: 'extra_hours',
    amountCents: 40_000,
    approvedOn: '2026-11-15',
    feeCents: 400,
  });

  const b2 = await insertBooking(db, {
    userId: user.id,
    roomId: room.id,
    startsAt: localToUtc('2026-11-25', 600),
    endsAt: localToUtc('2026-11-25', 720),
    status: 'paid',
    totalCents: 30_000,
    paidCents: 30_000,
    paymentMode: 'full_upfront',
    occupancy: false,
  });
  const [service] = await db.select().from(extraServices).limit(1);
  await db.insert(bookingExtraItems).values({
    bookingId: b2.id,
    serviceId: service?.id ?? '',
    serviceName: 'Pacote de filmagem',
    unit: 'hour',
    quantity: 1,
    unitPriceCents: 8_000,
    amountCents: 8_000,
  });
  await charge(db, {
    userId: user.id,
    bookingId: b2.id,
    purpose: 'booking_full',
    amountCents: 30_000,
    approvedOn: '2026-11-10',
  });

  const b3 = await insertBooking(db, {
    userId: user.id,
    roomId: room.id,
    startsAt: localToUtc('2026-12-10', 600),
    endsAt: localToUtc('2026-12-10', 720),
    status: 'cancelled_by_tenant',
    totalCents: 16_000,
    paidCents: 16_000,
    occupancy: false,
  });
  await db
    .update(bookings)
    .set({ cancelledAt: noon('2026-11-10') })
    .where(eq(bookings.id, b3.id));
  await charge(db, {
    userId: user.id,
    bookingId: b3.id,
    purpose: 'booking_deposit',
    amountCents: 8_000,
    approvedOn: '2026-11-01',
  });
  const balance = await charge(db, {
    userId: user.id,
    bookingId: b3.id,
    purpose: 'booking_balance',
    amountCents: 8_000,
    approvedOn: '2026-11-05',
    status: 'refunded',
  });
  await db.insert(refunds).values({
    chargeId: balance.id,
    bookingId: b3.id,
    provider: 'sandbox',
    amountCents: 8_000,
    reason: 'tenant_cancel',
    status: 'approved',
    completedAt: noon('2026-11-10'),
  });

  await db.insert(manualReceipts).values({
    date: '2026-11-12',
    revenueCategory: 'other',
    method: 'cash',
    amountCents: 5_000,
  });
  await db.insert(expenses).values([
    {
      date: '2026-11-05',
      categoryId: categoryA?.id ?? '',
      description: 'Aluguel',
      amountCents: 10_000,
    },
    {
      date: '2026-12-03',
      categoryId: categoryB?.id ?? '',
      description: 'Energia',
      amountCents: 3_000,
    },
    {
      date: '2026-11-06',
      categoryId: categoryA?.id ?? '',
      description: 'Excluída',
      amountCents: 999,
      deletedAt: now,
    },
  ]);
  return { categoryA, categoryB };
}

/** `Totals` of the given lines, with net and result derived as the API computes them. */
export function financeTotals(
  gross: number,
  discounts: number,
  refundsCents: number,
  fees: number,
  expensesCents: number,
) {
  const net = gross + discounts + refundsCents + fees;
  return {
    grossCents: gross,
    discountsCents: discounts,
    refundsCents,
    feesCents: fees,
    netCents: net,
    expensesCents,
    resultCents: net + expensesCents,
  };
}
