import { eq } from 'drizzle-orm';
import type { Db, Tx } from '../../db/client';
import { rooms, users, type bookings } from '../../db/schema';
import {
  bookingBalanceCardFailedTemplate,
  bookingBalanceChargeTemplate,
  bookingBalanceChargedTemplate,
  bookingBalanceReminderTemplate,
  bookingCancelledNonpaymentTemplate,
  bookingCancelledTemplate,
  bookingConfirmedTemplate,
  bookingLateApprovalRefundTemplate,
  bookingPreReservationExpiredTemplate,
  bookingPreReservationLinkTemplate,
  bookingReminder24hTemplate,
  bookingReminder2hTemplate,
  bookingRescheduledTemplate,
  setPasswordTemplate,
  type BookingEmailData,
  type BookingTemplate,
} from '../../emails/templates/booking';
import type { Rendered } from '../../emails/templates/layout';
import { queueEmail, type EmailAttachment } from '../../lib/email';
import { buildIcs, type IcsMethod } from '../../lib/ics';
import { appUrl } from '../../lib/request-meta';
import { loadSettings } from '../settings/settings.repo';

type BookingRow = typeof bookings.$inferSelect;

/** Everything a booking e-mail needs besides the booking row itself. */
export interface BookingMailContext {
  user: { name: string; email: string };
  roomName: string;
  /** `clinic.address_line`, used as the `.ics` LOCATION. */
  clinicAddress: string;
  appBaseUrl: string;
}

/** Loads the customer, room name and clinic address of a booking for its e-mails. */
export async function loadBookingMailContext(
  db: Db | Tx,
  booking: Pick<BookingRow, 'userId' | 'roomId'>,
  env: { APP_BASE_URL: string },
): Promise<BookingMailContext> {
  const [user] = await db
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, booking.userId));
  const [room] = await db
    .select({ name: rooms.name })
    .from(rooms)
    .where(eq(rooms.id, booking.roomId));
  if (user === undefined || room === undefined) {
    throw new Error('booking mail context: user or room not found');
  }
  const settings = await loadSettings(db);
  return {
    user,
    roomName: room.name,
    clinicAddress: settings['clinic.address_line'],
    appBaseUrl: env.APP_BASE_URL,
  };
}

/**
 * The booking's calendar entry (NUC-136, NUC-137): `DTSTART`/`DTEND` are the booking's own times
 * (cleanup excluded), `UID` is the stable `ics_uid` and `SEQUENCE` the row's `ics_sequence`, so
 * callers pass the booking after bumping the sequence on reschedule and cancellation.
 */
export function bookingIcs(
  booking: Pick<BookingRow, 'icsUid' | 'icsSequence' | 'startsAt' | 'endsAt' | 'code'>,
  ctx: Pick<BookingMailContext, 'roomName' | 'clinicAddress'>,
  method: Extract<IcsMethod, 'REQUEST' | 'CANCEL'>,
  now?: Date,
): string {
  return buildIcs({
    method,
    ...(now !== undefined && { now }),
    events: [
      {
        uid: booking.icsUid,
        sequence: booking.icsSequence,
        start: booking.startsAt,
        end: booking.endsAt,
        summary: `Reserva Bravô Clinic — ${ctx.roomName}`,
        location: ctx.clinicAddress,
        description: `Código ${booking.code}`,
      },
    ],
  });
}

function icsAttachment(
  booking: Parameters<typeof bookingIcs>[0],
  ctx: BookingMailContext,
  method: 'REQUEST' | 'CANCEL',
): EmailAttachment {
  return {
    filename: `reserva-${booking.code}.ics`,
    contentType: `text/calendar; charset=utf-8; method=${method}`,
    contentBase64: Buffer.from(bookingIcs(booking, ctx, method), 'utf8').toString('base64'),
  };
}

function bookingLink(booking: BookingRow, ctx: BookingMailContext): string {
  return appUrl({ APP_BASE_URL: ctx.appBaseUrl }, `/app/minhas-reservas/${booking.id}`);
}

function emailData(
  booking: BookingRow,
  ctx: BookingMailContext,
  extra: Partial<BookingEmailData> = {},
): BookingEmailData {
  return {
    name: ctx.user.name,
    code: booking.code,
    roomName: ctx.roomName,
    startsAt: booking.startsAt,
    endsAt: booking.endsAt,
    totalCents: booking.totalCents,
    paidCents: booking.paidCents,
    balanceCents: booking.balanceCents,
    link: bookingLink(booking, ctx),
    balanceDueAt: booking.balanceDueAt,
    holdExpiresAt: booking.holdExpiresAt,
    ...extra,
  };
}

interface Options {
  /** Full key space of the outbox `dedupe_key`; omitted for e-mails that may legitimately repeat. */
  dedupeKey?: string;
  attachments?: EmailAttachment[];
}

function queue(
  tx: Tx,
  to: string,
  template: BookingTemplate,
  rendered: Rendered,
  options: Options = {},
): Promise<string> {
  return queueEmail(tx, {
    to,
    template,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    ...(options.dedupeKey !== undefined && { dedupeKey: options.dedupeKey }),
    ...(options.attachments !== undefined && { attachments: options.attachments }),
  });
}

/**
 * The single núcleo notification helper (AD-025); gestao rewires it to `emit()`. Every helper
 * queues an outbox row in the caller's transaction and returns its id, so the caller dispatches
 * it after commit. Confirmed, rescheduled and cancelled carry the `.ics` attachment.
 */
export const bookingMailer = {
  /** First confirmation only: the dedupe key is the booking, so a repeat is a no-op. */
  confirmed(tx: Tx, booking: BookingRow, ctx: BookingMailContext): Promise<string> {
    return queue(
      tx,
      ctx.user.email,
      'booking.confirmed',
      bookingConfirmedTemplate(emailData(booking, ctx)),
      {
        dedupeKey: `booking.confirmed:${booking.id}`,
        attachments: [icsAttachment(booking, ctx, 'REQUEST')],
      },
    );
  },

  rescheduled(tx: Tx, booking: BookingRow, ctx: BookingMailContext): Promise<string> {
    return queue(
      tx,
      ctx.user.email,
      'booking.rescheduled',
      bookingRescheduledTemplate(emailData(booking, ctx)),
      {
        dedupeKey: `booking.rescheduled:${booking.id}:${String(booking.icsSequence)}`,
        attachments: [icsAttachment(booking, ctx, 'REQUEST')],
      },
    );
  },

  cancelled(
    tx: Tx,
    booking: BookingRow,
    ctx: BookingMailContext,
    extra: { refundCents?: number } = {},
  ): Promise<string> {
    return queue(
      tx,
      ctx.user.email,
      'booking.cancelled',
      bookingCancelledTemplate(emailData(booking, ctx, extra)),
      {
        dedupeKey: `booking.cancelled:${booking.id}`,
        attachments: [icsAttachment(booking, ctx, 'CANCEL')],
      },
    );
  },

  cancelledNonpayment(tx: Tx, booking: BookingRow, ctx: BookingMailContext): Promise<string> {
    return queue(
      tx,
      ctx.user.email,
      'booking.cancelled_nonpayment',
      bookingCancelledNonpaymentTemplate(emailData(booking, ctx)),
      {
        dedupeKey: `booking.cancelled_nonpayment:${booking.id}`,
        attachments: [icsAttachment(booking, ctx, 'CANCEL')],
      },
    );
  },

  /** Dedupe `booking_reminder:<id>:24` (NUC-138). */
  reminder24h(tx: Tx, booking: BookingRow, ctx: BookingMailContext): Promise<string> {
    return queue(
      tx,
      ctx.user.email,
      'booking.reminder_24h',
      bookingReminder24hTemplate(emailData(booking, ctx)),
      { dedupeKey: `booking_reminder:${booking.id}:24` },
    );
  },

  /** Dedupe `booking_reminder:<id>:2` (NUC-138). */
  reminder2h(tx: Tx, booking: BookingRow, ctx: BookingMailContext): Promise<string> {
    return queue(
      tx,
      ctx.user.email,
      'booking.reminder_2h',
      bookingReminder2hTemplate(emailData(booking, ctx)),
      { dedupeKey: `booking_reminder:${booking.id}:2` },
    );
  },

  balanceCharge(tx: Tx, booking: BookingRow, ctx: BookingMailContext): Promise<string> {
    return queue(
      tx,
      ctx.user.email,
      'booking.balance_charge',
      bookingBalanceChargeTemplate(emailData(booking, ctx)),
      { dedupeKey: `booking.balance_charge:${booking.id}` },
    );
  },

  /** One reminder per `payment.balance_reminder_hours_before` entry. */
  balanceReminder(
    tx: Tx,
    booking: BookingRow,
    ctx: BookingMailContext,
    extra: { hoursBefore: number },
  ): Promise<string> {
    return queue(
      tx,
      ctx.user.email,
      'booking.balance_reminder',
      bookingBalanceReminderTemplate(emailData(booking, ctx)),
      { dedupeKey: `balance_reminder:${booking.id}:${String(extra.hoursBefore)}` },
    );
  },

  balanceCharged(
    tx: Tx,
    booking: BookingRow,
    ctx: BookingMailContext,
    extra: { chargeId: string },
  ): Promise<string> {
    return queue(
      tx,
      ctx.user.email,
      'booking.balance_charged',
      bookingBalanceChargedTemplate(emailData(booking, ctx)),
      { dedupeKey: `booking.balance_charged:${extra.chargeId}` },
    );
  },

  balanceCardFailed(
    tx: Tx,
    booking: BookingRow,
    ctx: BookingMailContext,
    extra: { chargeId: string },
  ): Promise<string> {
    return queue(
      tx,
      ctx.user.email,
      'booking.balance_card_failed',
      bookingBalanceCardFailedTemplate(emailData(booking, ctx)),
      { dedupeKey: `booking.balance_card_failed:${extra.chargeId}` },
    );
  },

  /** Sent every time staff resend the link, so it has no dedupe key. */
  preReservationLink(
    tx: Tx,
    booking: BookingRow,
    ctx: BookingMailContext,
    extra: { link: string },
  ): Promise<string> {
    return queue(
      tx,
      ctx.user.email,
      'booking.pre_reservation_link',
      bookingPreReservationLinkTemplate(emailData(booking, ctx, { link: extra.link })),
    );
  },

  preReservationExpired(tx: Tx, booking: BookingRow, ctx: BookingMailContext): Promise<string> {
    return queue(
      tx,
      ctx.user.email,
      'booking.pre_reservation_expired',
      bookingPreReservationExpiredTemplate(
        emailData(booking, ctx, { link: appUrl({ APP_BASE_URL: ctx.appBaseUrl }, '/reservar') }),
      ),
      { dedupeKey: `booking.pre_reservation_expired:${booking.id}` },
    );
  },

  /** NUC-117: the slot was taken, the payment is refunded and 3 free slots are suggested. */
  lateApprovalRefund(
    tx: Tx,
    booking: BookingRow,
    ctx: BookingMailContext,
    extra: {
      chargeId: string;
      refundCents: number;
      suggestions: { startsAt: Date; endsAt: Date }[];
    },
  ): Promise<string> {
    return queue(
      tx,
      ctx.user.email,
      'booking.late_approval_refund',
      bookingLateApprovalRefundTemplate(
        emailData(booking, ctx, {
          refundCents: extra.refundCents,
          suggestions: extra.suggestions,
          link: appUrl({ APP_BASE_URL: ctx.appBaseUrl }, '/reservar'),
        }),
      ),
      { dedupeKey: `booking.late_approval_refund:${extra.chargeId}` },
    );
  },

  /** Account created by staff: the customer defines a password through the link. */
  setPassword(
    tx: Tx,
    user: { name: string; email: string },
    extra: { link: string },
  ): Promise<string> {
    return queue(
      tx,
      user.email,
      'account.set_password',
      setPasswordTemplate({ ...user, ...extra }),
    );
  },
};
