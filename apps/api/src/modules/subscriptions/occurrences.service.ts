import {
  occurrenceConflictLabel,
  policySnapshot,
  type LocalDate,
  type OccurrenceConflict,
  type SettingsValues,
} from '@bravo/core';
import { and, asc, eq, gt, inArray } from 'drizzle-orm';
import type { Tx } from '../../db/client';
import { bookings, users, rooms } from '../../db/schema';
import type { BookingRow } from '../../extensions/registry';
import type { RequestContext } from '../../lib/audit';
import type { EmailAttachment } from '../../lib/email';
import { AppError } from '../../lib/errors';
import { buildIcs } from '../../lib/ics';
import { insertBookingWithOccupancy } from '../booking/create-booking.service';
import { transitionBooking } from '../booking/transition';

// Fixed-schedule occurrences (REC-86, REC-87, REC-88): each one is a booking of kind
// `fixed_occurrence`, priced by the subscription, with an occupancy `[start, end + cleanup)`.

type OccurrenceStatus = 'awaiting_payment' | 'pre_reserved' | 'held_for_renewal' | 'confirmed';

/** 409 `OCCURRENCE_CONFLICT` listing every conflicting date (REC-85, REC-87, AD-030). */
export function occurrenceConflict(conflicts: OccurrenceConflict[]): AppError {
  return new AppError(
    409,
    'OCCURRENCE_CONFLICT',
    'Algumas datas deste horário fixo não estão livres',
    conflicts.map((c) => ({ path: 'date', message: c.label, date: c.date, reason: c.reason })),
  );
}

export interface OccurrenceInsertArgs {
  userId: string;
  roomId: string;
  subscriptionId: string;
  periodId: string;
  status: OccurrenceStatus;
  holdExpiresAt: Date | null;
  source: 'web' | 'app' | 'admin' | 'mcp';
  settings: SettingsValues;
  occurrences: { date: LocalDate; startsAt: Date; endsAt: Date }[];
}

/**
 * Inserts every occurrence; the first one the exclusion constraint refuses aborts the caller's
 * transaction with 409 `OCCURRENCE_CONFLICT` naming that date (REC-87).
 */
export async function insertOccurrences(
  tx: Tx,
  ctx: RequestContext,
  args: OccurrenceInsertArgs,
): Promise<BookingRow[]> {
  const out: BookingRow[] = [];
  for (const occurrence of args.occurrences) {
    const booking = await insertOccurrence(tx, ctx, args, occurrence);
    if (booking === null) {
      throw occurrenceConflict([
        {
          date: occurrence.date,
          reason: 'overlaps_booking',
          label: occurrenceConflictLabel('overlaps_booking'),
        },
      ]);
    }
    out.push(booking);
  }
  return out;
}

/** One occurrence; `null` when its slot is taken (the savepoint keeps the caller's transaction). */
export async function insertOccurrence(
  tx: Tx,
  ctx: RequestContext,
  args: Omit<OccurrenceInsertArgs, 'occurrences'>,
  occurrence: { startsAt: Date; endsAt: Date },
): Promise<BookingRow | null> {
  try {
    return await insertBookingWithOccupancy(tx, {
      userId: args.userId,
      roomId: args.roomId,
      kind: 'fixed_occurrence',
      status: args.status,
      source: args.source,
      createdByUserId: ctx.actorUserId,
      startsAt: occurrence.startsAt,
      endsAt: occurrence.endsAt,
      cleanupMinutes: args.settings['calendar.cleanup_minutes'],
      durationMinutes: Math.round(
        (occurrence.endsAt.getTime() - occurrence.startsAt.getTime()) / 60_000,
      ),
      paymentMode: 'subscription',
      holdExpiresAt: args.holdExpiresAt,
      policySnapshot: policySnapshot(args.settings),
      subscriptionId: args.subscriptionId,
      subscriptionPeriodId: args.periodId,
    });
  } catch (error) {
    if (error instanceof AppError && error.code === 'SLOT_TAKEN') return null;
    throw error;
  }
}

/** Occurrences of a subscription in the given statuses, by start. */
export function occurrencesOf(
  tx: Tx,
  subscriptionId: string,
  statuses: readonly string[],
  opts: { periodId?: string; startsAfter?: Date } = {},
): Promise<BookingRow[]> {
  return tx
    .select()
    .from(bookings)
    .where(
      and(
        eq(bookings.subscriptionId, subscriptionId),
        eq(bookings.kind, 'fixed_occurrence'),
        inArray(bookings.status, [...statuses]),
        opts.periodId === undefined ? undefined : eq(bookings.subscriptionPeriodId, opts.periodId),
        opts.startsAfter === undefined ? undefined : gt(bookings.startsAt, opts.startsAfter),
      ),
    )
    .orderBy(asc(bookings.startsAt));
}

/** Moves each occurrence `from → to` through nucleo's booking transition (history, occupancy). */
export async function transitionOccurrences(
  tx: Tx,
  ctx: RequestContext,
  list: BookingRow[],
  to: 'confirmed' | 'expired' | 'cancelled_by_tenant' | 'cancelled_by_clinic',
  reason: string,
  now: Date,
): Promise<BookingRow[]> {
  const out: BookingRow[] = [];
  for (const booking of list) {
    const cancelled = to.startsWith('cancelled');
    out.push(
      await transitionBooking(
        tx,
        ctx,
        booking.id,
        [booking.status as OccurrenceStatus],
        to,
        reason,
        undefined,
        {
          holdExpiresAt: null,
          ...(cancelled && {
            cancelledAt: now,
            cancelReason: reason,
            cancelledBy: ctx.actorUserId,
          }),
        },
      ),
    );
  }
  return out;
}

/** One `.ics` with a VEVENT per occurrence (REC-88). */
export async function occurrencesIcs(
  tx: Tx,
  list: BookingRow[],
  opts: { address: string; now: Date },
): Promise<EmailAttachment> {
  const roomIds = [...new Set(list.map((b) => b.roomId))];
  const names = new Map(
    (
      await tx
        .select({ id: rooms.id, name: rooms.name })
        .from(rooms)
        .where(
          inArray(
            rooms.id,
            roomIds.length > 0 ? roomIds : ['00000000-0000-0000-0000-000000000000'],
          ),
        )
    ).map((r) => [r.id, r.name]),
  );
  const text = buildIcs({
    method: 'REQUEST',
    now: opts.now,
    events: list.map((b) => ({
      uid: b.icsUid,
      sequence: b.icsSequence,
      start: b.startsAt,
      end: b.endsAt,
      summary: `Horário fixo Bravô Clinic — ${names.get(b.roomId) ?? ''}`.trim(),
      location: opts.address,
      description: `Código ${b.code}`,
    })),
  });
  return {
    filename: 'horario-fixo.ics',
    contentType: 'text/calendar; charset=utf-8; method=REQUEST',
    contentBase64: Buffer.from(text, 'utf8').toString('base64'),
  };
}

/** Name and e-mail of the subscriber. */
export async function subscriberOf(
  tx: Tx,
  userId: string,
): Promise<{ name: string; email: string }> {
  const [user] = await tx
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, userId));
  if (user === undefined) throw new Error('subscriber not found');
  return user;
}
