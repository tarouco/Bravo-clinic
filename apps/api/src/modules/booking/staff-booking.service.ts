import { utcToLocal, type BookingStatus, type StaffCreateBookingInput } from '@bravo/core';
import { and, eq, gt, sql } from 'drizzle-orm';
import type { Tx } from '../../db/client';
import { bookings, roomOccupancy, rooms, users } from '../../db/schema';
import type { BookingRow } from '../../extensions/registry';
import { audit, type RequestContext } from '../../lib/audit';
import { sha256Hex } from '../../lib/crypto';
import {
  AppError,
  conflict,
  forbidden,
  notFound,
  sqlStateOf,
  validationFailed,
} from '../../lib/errors';
import { getRoomById } from '../calendar/calendar.repo';
import { lockCalendarDate } from '../calendar/calendar-lock';
import type { PaymentDeps } from '../payments/charges.service';
import { loadSettings } from '../settings/settings.repo';
import { bookingMailer, loadBookingMailContext } from './booking-mailer';
import { createBooking, issuePaymentLink, type BookingVariant } from './create-booking.service';
import { flushAfterCommit, newAfterCommit } from './effects';
import { cancelPendingCharges } from './expire-booking';
import { transitionBooking } from './transition';

export interface Staff {
  id: string;
  role: 'admin' | 'reception';
}

const HOLDING: readonly BookingStatus[] = ['awaiting_payment', 'pre_reserved'];
const CHECK_IN_LEAD_MS = 60 * 60_000;

/**
 * `POST /admin/bookings` (NUC-161..NUC-163): a checkout hold, a pre-reservation or, for admins
 * only, a booking confirmed without payment. The customer receives the payment link by e-mail.
 */
export async function staffCreateBooking(
  deps: PaymentDeps,
  ctx: RequestContext,
  staff: Staff,
  input: StaffCreateBookingInput,
): Promise<{ booking: BookingRow; paymentLink: string | null }> {
  const manual = input.confirmManually === true;
  if (manual && staff.role !== 'admin') throw forbidden();

  const room = await getRoomById(deps.db, input.roomId);
  if (room === null || room.status !== 'active') throw notFound('NOT_FOUND', 'Sala não encontrada');
  const [customer] = await deps.db.select().from(users).where(eq(users.id, input.userId));
  if (customer?.role !== 'tenant') {
    throw validationFailed([{ path: ['userId'], message: 'Cliente não encontrado' }]);
  }

  let variant: BookingVariant = { type: 'checkout' };
  if (manual) {
    variant = { type: 'manual', justification: input.justification ?? '' };
  } else if (input.kind === 'pre_reservation') {
    const settings = await loadSettings(deps.db);
    variant = {
      type: 'pre_reservation',
      expiresInHours: input.expiresInHours ?? settings['payment.pre_reservation_expiry_hours'],
    };
  }
  const { booking, paymentLink } = await createBooking(
    deps,
    {
      userId: input.userId,
      request: {
        roomSlug: room.slug,
        date: input.date,
        startMinute: input.startMinute,
        endMinute: input.endMinute,
        ...(input.blockCategoryId !== undefined && { blockCategoryId: input.blockCategoryId }),
      },
    },
    { source: 'admin', staff, variant, paymentLink: !manual, ctx },
  );
  return { booking, paymentLink };
}

async function lockBooking(tx: Tx, id: string) {
  const [booking] = await tx.select().from(bookings).where(eq(bookings.id, id)).for('update');
  if (booking === undefined) throw notFound();
  return booking;
}

/**
 * `POST /admin/bookings/:id/confirm-manual` (NUC-163): admin only. The pre-reservation or
 * awaiting booking becomes `confirmed` with `payment_mode = 'manual'`: no balance schedule, any
 * pending charge cancelled, the payment left to the clinic.
 */
export async function confirmManual(
  deps: PaymentDeps,
  ctx: RequestContext,
  bookingId: string,
  justification: string,
): Promise<BookingRow> {
  const fx = newAfterCommit();
  const confirmed = await deps.db.transaction(async (tx) => {
    const booking = await lockBooking(tx, bookingId);
    if (!HOLDING.includes(booking.status as BookingStatus)) {
      throw conflict('INVALID_TRANSITION', 'A reserva não aguarda pagamento.');
    }
    await tx
      .update(bookings)
      .set({
        paymentMode: 'manual',
        depositCents: 0,
        balanceChargeAt: null,
        balanceDueAt: null,
        updatedAt: sql`now()`,
      })
      .where(eq(bookings.id, booking.id));
    const result = await transitionBooking(
      tx,
      ctx,
      booking.id,
      [booking.status as BookingStatus],
      'confirmed',
      'confirmed_manually',
      { justification },
      {
        confirmedManuallyBy: ctx.actorUserId,
        holdExpiresAt: null,
        balanceCents: Math.max(0, booking.totalCents - booking.paidCents),
      },
    );
    await cancelPendingCharges(tx, booking.id, fx);
    for (const step of deps.registry.checkoutSteps) {
      await step.onConfirmed?.(tx, result, deps.now());
    }
    const mail = await loadBookingMailContext(tx, result, deps.env);
    fx.emailIds.push(await bookingMailer.confirmed(tx, result, mail));
    fx.staff.push({ event: 'new_booking', payload: { entityId: result.id, code: result.code } });
    await audit(tx, ctx, {
      action: 'booking.confirm_manual',
      entityType: 'booking',
      entityId: booking.id,
      justification,
      before: { status: booking.status },
      after: { status: result.status, paymentMode: 'manual' },
    });
    return result;
  });
  await flushAfterCommit(deps, fx, ctx);
  return confirmed;
}

/** `POST /admin/bookings/:id/resend-link` (NUC-164): a new token replaces the old one. */
export async function resendPaymentLink(
  deps: PaymentDeps,
  ctx: RequestContext,
  bookingId: string,
): Promise<string> {
  const fx = newAfterCommit();
  const link = await deps.db.transaction(async (tx) => {
    const booking = await lockBooking(tx, bookingId);
    if (
      !HOLDING.includes(booking.status as BookingStatus) ||
      booking.holdExpiresAt === null ||
      booking.holdExpiresAt <= deps.now()
    ) {
      throw conflict('INVALID_STATE', 'A reserva não aguarda mais pagamento.');
    }
    const url = await issuePaymentLink(tx, deps, booking.id);
    const mail = await loadBookingMailContext(tx, booking, deps.env);
    fx.emailIds.push(await bookingMailer.preReservationLink(tx, booking, mail, { link: url }));
    await audit(tx, ctx, {
      action: 'booking.resend_link',
      entityType: 'booking',
      entityId: booking.id,
    });
    return url;
  });
  await flushAfterCommit(deps, fx, ctx);
  return link;
}

/**
 * `GET /public/pre-reservations/:token` (NUC-165): the holding booking behind a payment link, or
 * 404 for an unknown token, a rotated one or an expired hold.
 */
export async function resolvePaymentLinkToken(db: PaymentDeps['db'], token: string, now: Date) {
  const [row] = await db
    .select({ booking: bookings, roomName: rooms.name, customerName: users.name })
    .from(bookings)
    .innerJoin(rooms, eq(rooms.id, bookings.roomId))
    .innerJoin(users, eq(users.id, bookings.userId))
    .where(
      and(
        eq(bookings.paymentLinkTokenHash, sha256Hex(token)),
        sql`${bookings.status} in ('awaiting_payment', 'pre_reserved')`,
        gt(bookings.holdExpiresAt, now),
      ),
    );
  if (row === undefined || row.booking.holdExpiresAt === null) throw notFound();
  return {
    bookingId: row.booking.id,
    code: row.booking.code,
    roomName: row.roomName,
    startsAt: row.booking.startsAt.toISOString(),
    endsAt: row.booking.endsAt.toISOString(),
    totalCents: row.booking.totalCents,
    holdExpiresAt: row.booking.holdExpiresAt.toISOString(),
    customerFirstName: row.customerName.split(' ')[0] ?? row.customerName,
  };
}

/**
 * `POST /admin/bookings/:id/check-in` (NUC-167): from 60 minutes before the start until the end
 * of a confirmed or paid booking.
 */
export async function checkIn(
  deps: PaymentDeps,
  ctx: RequestContext,
  bookingId: string,
): Promise<BookingRow> {
  const now = deps.now();
  return deps.db.transaction(async (tx) => {
    const booking = await lockBooking(tx, bookingId);
    const inWindow =
      (booking.status === 'confirmed' || booking.status === 'paid') &&
      now.getTime() >= booking.startsAt.getTime() - CHECK_IN_LEAD_MS &&
      now.getTime() <= booking.endsAt.getTime();
    if (!inWindow) {
      throw conflict('INVALID_STATE', 'Check-in disponível de 1h antes até o fim da reserva.');
    }
    if (booking.checkedInAt !== null) return booking;
    const [updated] = await tx
      .update(bookings)
      .set({ checkedInAt: now, updatedAt: sql`now()` })
      .where(eq(bookings.id, booking.id))
      .returning();
    if (updated === undefined) throw notFound();
    await audit(tx, ctx, {
      action: 'booking.check_in',
      entityType: 'booking',
      entityId: booking.id,
      after: { checkedInAt: now },
    });
    return updated;
  });
}

/**
 * `PATCH /admin/bookings/:id/cleanup` (NUC-39): admin only. Overrides the booking's cleanup
 * minutes, keeps it out of later global cleanup changes and stretches or shrinks its occupancy;
 * a neighbour that would collide makes it a 409.
 */
export async function setCleanupException(
  deps: PaymentDeps,
  ctx: RequestContext,
  bookingId: string,
  input: { cleanupMinutes: number; justification: string },
): Promise<BookingRow> {
  const now = deps.now();
  return deps.db.transaction(async (tx) => {
    const booking = await lockBooking(tx, bookingId);
    if (!['awaiting_payment', 'pre_reserved', 'confirmed', 'paid'].includes(booking.status)) {
      throw conflict('INVALID_STATE', 'A reserva não ocupa mais a sala.');
    }
    await lockCalendarDate(tx, utcToLocal(booking.startsAt).date);
    const until = new Date(booking.endsAt.getTime() + input.cleanupMinutes * 60_000);
    try {
      await tx.transaction(async (savepoint) => {
        const moved = await savepoint
          .update(roomOccupancy)
          .set({
            period: `[${booking.startsAt.toISOString()},${until.toISOString()})`,
            updatedAt: sql`now()`,
          })
          .where(
            and(
              eq(roomOccupancy.kind, 'booking'),
              eq(roomOccupancy.refId, booking.id),
              eq(roomOccupancy.active, true),
            ),
          )
          .returning({ id: roomOccupancy.id });
        if (moved.length === 0) throw conflict('INVALID_STATE', 'A reserva não ocupa mais a sala.');
      });
    } catch (error) {
      if (sqlStateOf(error) === '23P01') {
        throw new AppError(
          409,
          'SLOT_TAKEN',
          'Há outra reserva logo após esta; a limpeza não cabe.',
        );
      }
      throw error;
    }
    const [updated] = await tx
      .update(bookings)
      .set({
        cleanupMinutes: input.cleanupMinutes,
        cleanupOverriddenBy: ctx.actorUserId,
        cleanupOverriddenAt: now,
        updatedAt: sql`now()`,
      })
      .where(eq(bookings.id, booking.id))
      .returning();
    if (updated === undefined) throw notFound();
    await audit(tx, ctx, {
      action: 'booking.cleanup_exception',
      entityType: 'booking',
      entityId: booking.id,
      justification: input.justification,
      before: { cleanupMinutes: booking.cleanupMinutes },
      after: { cleanupMinutes: input.cleanupMinutes },
    });
    return updated;
  });
}
