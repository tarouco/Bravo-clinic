import { utcToLocal } from '@bravo/core';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { bookingEvents, bookings, creditLots } from '../../db/schema';
import { getEnv } from '../../env';
import type {
  AvailabilityDecorator,
  ClosedDayCompensationPort,
  CreditPort,
  PaymentModeHandler,
} from '../../extensions/registry';
import { SYSTEM_CONTEXT } from '../payments/payment-effects.service';
import { availableCredit, grantCredit } from '../credits/credits.service';
import { redebitForReschedule, returnForCancellation } from '../packages/package-payment.service';
import { discountMinutes } from '../slot-discounts/slot-discounts.service';
import { applyClosedDay, previewClosedDay } from '../subscriptions/compensation.service';
import { bookingContext, packageDraftOf } from './steps';

// Receita's ports in nucleo's registry (design.md "Required from nucleo" A, AD-031).

/** Package bookings: re-debit on reschedule (REC-37), minute returns on cancel (REC-34..REC-38). */
export const packageModeHandler: PaymentModeHandler = {
  mode: 'package',
  async reschedule(tx, booking, next) {
    const draft = packageDraftOf(next);
    if (draft === null) throw new Error('package reschedule without a package draft');
    await redebitForReschedule(tx, bookingContext(booking), {
      bookingId: booking.id,
      userId: booking.userId,
      draft,
      now: new Date(),
    });
    return { payNowCents: 0 };
  },
  async cancel(tx, booking, evaluation) {
    // nucleo evaluates the debited minutes: > 0 means within the deadline, or a clinic cancel.
    return returnForCancellation(tx, bookingContext(booking), booking.id, {
      withinDeadline: evaluation.minutesReturned > 0,
      actor: evaluation.clinicOptions.length > 0 ? 'clinic' : 'tenant',
      now: new Date(),
    });
  },
};

/** Fixed occurrences: subscription-priced, no money moves (REC-94, REC-95). */
export const subscriptionModeHandler: PaymentModeHandler = {
  mode: 'subscription',
  reschedule: () => Promise.resolve({ payNowCents: 0 }),
  cancel: () => Promise.resolve({ minutesReturned: 0 }),
};

/** Live credits (REC-106, REC-110, REC-111). */
export const liveCreditPort: CreditPort = {
  mode: 'live',
  availableCents: (db, userId, now) => availableCredit(db, userId, now),
  async grant(tx, input) {
    const lot = await grantCredit(tx, input.ctx, {
      userId: input.userId,
      amountCents: input.amountCents,
      source: input.source,
      refType: input.refType,
      refId: input.refId,
      bookingId: input.refType === 'booking' ? input.refId : null,
      now: new Date(),
    });
    return { creditLotId: lot.id };
  },
};

/**
 * Turns the grants nucleo recorded while credits were deferred (`booking_events.data.creditGrant`
 * with `status: 'deferred'`, AD-033) into credit lots, once: each lot carries
 * `ref_type = 'booking_event:<id>'`, so a second run creates nothing.
 */
export async function backfillDeferredCreditGrants(db: Db, now: Date): Promise<number> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('receita:credit-backfill'))`);
    const events = await tx
      .select({
        id: bookingEvents.id,
        data: bookingEvents.data,
        userId: bookings.userId,
        bookingId: bookings.id,
      })
      .from(bookingEvents)
      .innerJoin(bookings, eq(bookings.id, bookingEvents.bookingId))
      .where(sql`${bookingEvents.data} -> 'creditGrant' ->> 'status' = 'deferred'`)
      .orderBy(asc(bookingEvents.id));
    let created = 0;
    for (const event of events) {
      const grant = (event.data as { creditGrant?: { amountCents?: unknown } }).creditGrant;
      const amount = typeof grant?.amountCents === 'number' ? grant.amountCents : 0;
      if (amount <= 0) continue;
      const refType = `booking_event:${String(event.id)}`;
      const [existing] = await tx
        .select({ id: creditLots.id })
        .from(creditLots)
        .where(and(eq(creditLots.refType, refType), eq(creditLots.userId, event.userId)));
      if (existing !== undefined) continue;
      await grantCredit(tx, SYSTEM_CONTEXT, {
        userId: event.userId,
        amountCents: amount,
        source: 'reschedule_difference',
        refType,
        refId: event.bookingId,
        bookingId: event.bookingId,
        now,
      });
      created += 1;
    }
    return created;
  });
}

/** Closed-day compensation (REC-97..REC-104). */
export const closedDayCompensationPort: ClosedDayCompensationPort = {
  preview: (db, args) => previewClosedDay(db, args),
  async apply(tx, closedDayIds, ctx) {
    await applyClosedDay(tx, closedDayIds, ctx, {
      now: new Date(),
      appBaseUrl: getEnv().APP_BASE_URL,
    });
  },
};

/** `discountPercent` on available public cells inside an active discount (REC-136, REC-140). */
export const slotDiscountDecorator: AvailabilityDecorator = {
  async decorate(db, { roomId, date, cells, now }) {
    const parts = await discountMinutes(db, { roomId, date, now });
    if (parts.length === 0) return cells;
    const nowMinute = utcToLocal(now).date === date ? utcToLocal(now).minuteOfDay : -1;
    return cells.map((cell) => {
      if (!cell.available) return cell;
      const part = parts.find(
        (p) => p.startMinute <= cell.startMinute && cell.startMinute < p.endMinute,
      );
      if (part === undefined || cell.startMinute < nowMinute) return cell;
      return { ...cell, discountPercent: part.percent };
    });
  },
};
