import { and, asc, eq, gt, inArray, lte, sql } from 'drizzle-orm';
import { bookings, charges, emailOutbox } from '../db/schema';
import {
  bookingMailer,
  loadBookingMailContext,
  type BookingMailContext,
} from '../modules/booking/booking-mailer';
import { flushAfterCommit, newAfterCommit } from '../modules/booking/effects';
import { loadSettings } from '../modules/settings/settings.repo';
import { JOB_CONTEXT, type Job, type JobDeps } from './runner';
import type { Tx } from '../db/client';
import type { BookingRow } from '../extensions/registry';

const HOUR_MS = 3_600_000;
const BATCH = 200;

type Send = (tx: Tx, booking: BookingRow, mail: BookingMailContext) => Promise<string>;

/**
 * Queues an e-mail unless its dedupe key is already in the outbox, so repeated runs and runs
 * that overlap a window send it once (NUC-133, NUC-138). Returns whether a new row was queued.
 */
async function queueOnce(
  deps: JobDeps,
  booking: BookingRow,
  dedupeKey: string,
  send: Send,
): Promise<boolean> {
  const [existing] = await deps.db
    .select({ id: emailOutbox.id })
    .from(emailOutbox)
    .where(eq(emailOutbox.dedupeKey, dedupeKey));
  if (existing !== undefined) return false;
  const fx = newAfterCommit();
  await deps.db.transaction(async (tx) => {
    const mail = await loadBookingMailContext(tx, booking, deps.env);
    fx.emailIds.push(await send(tx, booking, mail));
  });
  await flushAfterCommit(deps, fx, JOB_CONTEXT);
  return true;
}

/**
 * E-mail reminders (NUC-133, NUC-138). A confirmed booking with a pending Pix balance gets one
 * `booking.balance_reminder` per configured hour before its start (the latest hour that has
 * passed; a run after a missed hour does not replay the earlier ones). Confirmed and paid
 * bookings get `booking.reminder_24h` and `booking.reminder_2h` once each, inside a one-hour
 * window after the mark, so a booking made late never receives a reminder that is already past.
 */
export const reminders: Job = async (deps, now) => {
  const settings = await loadSettings(deps.db);
  const hours = [...settings['payment.balance_reminder_hours_before']].sort((a, b) => a - b);
  const stats = { balanceReminders: 0, reminders24h: 0, reminders2h: 0 };

  const widest = hours.at(-1);
  if (widest !== undefined) {
    const candidates = await deps.db
      .select()
      .from(bookings)
      .where(
        and(
          eq(bookings.status, 'confirmed'),
          gt(bookings.balanceCents, 0),
          gt(bookings.balanceDueAt, now),
          gt(bookings.startsAt, now),
          lte(bookings.startsAt, new Date(now.getTime() + widest * HOUR_MS)),
          sql`exists (
            select 1 from ${charges}
            where ${charges.bookingId} = ${bookings.id}
              and ${charges.status} = 'pending'
              and ${charges.method} = 'pix'
              and ${charges.purpose} in ('booking_balance', 'booking_difference')
          )`,
        ),
      )
      .orderBy(asc(bookings.startsAt))
      .limit(BATCH);
    for (const booking of candidates) {
      // The smallest configured hour whose mark has passed is the one this booking is at.
      const hoursBefore = hours.find(
        (h) => now.getTime() >= booking.startsAt.getTime() - h * HOUR_MS,
      );
      if (hoursBefore === undefined) continue;
      const queued = await queueOnce(
        deps,
        booking,
        `balance_reminder:${booking.id}:${String(hoursBefore)}`,
        (tx, row, mail) => bookingMailer.balanceReminder(tx, row, mail, { hoursBefore }),
      );
      if (queued) stats.balanceReminders += 1;
    }
  }

  const windowOf = async (hoursAhead: number) =>
    deps.db
      .select()
      .from(bookings)
      .where(
        and(
          inArray(bookings.status, ['confirmed', 'paid']),
          gt(bookings.startsAt, new Date(now.getTime() + (hoursAhead - 1) * HOUR_MS)),
          lte(bookings.startsAt, new Date(now.getTime() + hoursAhead * HOUR_MS)),
        ),
      )
      .orderBy(asc(bookings.startsAt))
      .limit(BATCH);
  for (const booking of await windowOf(24)) {
    const queued = await queueOnce(
      deps,
      booking,
      `booking_reminder:${booking.id}:24`,
      (tx, row, mail) => bookingMailer.reminder24h(tx, row, mail),
    );
    if (queued) stats.reminders24h += 1;
  }
  for (const booking of await windowOf(2)) {
    const queued = await queueOnce(
      deps,
      booking,
      `booking_reminder:${booking.id}:2`,
      (tx, row, mail) => bookingMailer.reminder2h(tx, row, mail),
    );
    if (queued) stats.reminders2h += 1;
  }
  return stats;
};
