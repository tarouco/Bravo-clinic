import type { PolicySnapshot } from '@bravo/core';
import { and, asc, inArray, isNotNull, isNull, lte } from 'drizzle-orm';
import { bookings } from '../db/schema';
import { logger } from '../lib/logger';
import { transitionBooking } from '../modules/booking/transition';
import { JOB_CONTEXT, type Job } from './runner';

const BATCH = 200;
/** `policy.no_show_after_minutes` cannot be below this, so it bounds the candidate query. */
const MIN_NO_SHOW_MINUTES = 5;

/**
 * Attendance (NUC-168): a confirmed or paid booking with no check-in `no_show_after_minutes`
 * after its start (the value frozen in its snapshot) becomes `no_show`; a checked-in booking
 * becomes `completed` once it has ended. Every change is a guarded transition, so re-running
 * is harmless.
 */
export const noShows: Job = async (deps, now) => {
  let noShow = 0;
  let completed = 0;

  const absent = await deps.db
    .select()
    .from(bookings)
    .where(
      and(
        inArray(bookings.status, ['confirmed', 'paid']),
        isNull(bookings.checkedInAt),
        lte(bookings.startsAt, new Date(now.getTime() - MIN_NO_SHOW_MINUTES * 60_000)),
      ),
    )
    .orderBy(asc(bookings.startsAt))
    .limit(BATCH);
  for (const booking of absent) {
    const minutes = (booking.policySnapshot as PolicySnapshot)['policy.no_show_after_minutes'];
    if (now.getTime() < booking.startsAt.getTime() + minutes * 60_000) continue;
    try {
      await deps.db.transaction((tx) =>
        transitionBooking(
          tx,
          JOB_CONTEXT,
          booking.id,
          ['confirmed', 'paid'],
          'no_show',
          'no_show',
          {
            afterMinutes: minutes,
          },
        ),
      );
      noShow += 1;
    } catch (error) {
      logger.warn('no-show transition skipped', {
        bookingId: booking.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const finished = await deps.db
    .select({ id: bookings.id })
    .from(bookings)
    .where(
      and(
        inArray(bookings.status, ['confirmed', 'paid']),
        isNotNull(bookings.checkedInAt),
        lte(bookings.endsAt, now),
      ),
    )
    .orderBy(asc(bookings.endsAt))
    .limit(BATCH);
  for (const { id } of finished) {
    try {
      await deps.db.transaction((tx) =>
        transitionBooking(tx, JOB_CONTEXT, id, ['confirmed', 'paid'], 'completed', 'completed'),
      );
      completed += 1;
    } catch (error) {
      logger.warn('completion transition skipped', {
        bookingId: id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { noShow, completed };
};
