import { sql } from 'drizzle-orm';
import type { LocalDate } from '@bravo/core';
import type { Tx } from '../../db/client';

/**
 * Transaction-scoped advisory lock on one local date (NUC-51). Booking creation, reschedule and
 * closed-day or holiday closing take it for every date they touch, in ascending date order, so a
 * concurrent booking either shows up as affected or is rejected as closed.
 */
export async function lockCalendarDate(tx: Tx, date: LocalDate): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`cal:${date}`}))`);
}

/** Locks several dates in ascending order, which keeps two such transactions from deadlocking. */
export async function lockCalendarDates(tx: Tx, dates: LocalDate[]): Promise<void> {
  for (const date of [...new Set(dates)].sort()) await lockCalendarDate(tx, date);
}
