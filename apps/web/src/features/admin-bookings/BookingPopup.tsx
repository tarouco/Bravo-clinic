import { formatBRL, formatTimeBR, type Role } from '@bravo/core';
import { StatusBadge } from '../../components/booking/StatusBadge';
import { Button } from '../../components/ui/Button';
import { bookingWhen } from '../../lib/booking-time';
import { formatDuration } from '../../lib/format';
import type { BookingActionKind, CalendarBooking } from './BookingActions';

const HOLDING = ['awaiting_payment', 'pre_reserved'] as const;
const ACTIVE = ['awaiting_payment', 'pre_reserved', 'confirmed', 'paid'] as const;
const CHECKABLE = ['confirmed', 'paid'] as const;

type Status = CalendarBooking['status'];
const among = (status: Status, list: readonly Status[]) => list.includes(status);

/** The actions the popup offers for a role and a booking (NUC-159). */
export function popupActions(booking: CalendarBooking, role: Role): BookingActionKind[] {
  const isAdmin = role === 'admin';
  const actions: BookingActionKind[] = [];
  if (isAdmin && among(booking.status, HOLDING)) actions.push('confirm');
  // A payment link also serves a confirmed booking that still owes its balance.
  if (
    among(booking.status, HOLDING) ||
    (among(booking.status, CHECKABLE) && booking.paidCents < booking.totalCents)
  ) {
    actions.push('resend');
  }
  if (isAdmin && among(booking.status, ACTIVE)) actions.push('reschedule', 'cancel');
  if (among(booking.status, CHECKABLE) && booking.checkedInAt === null) actions.push('checkin');
  return actions;
}

const LABELS: Record<BookingActionKind, string> = {
  confirm: 'Confirmar',
  resend: 'Reenviar link',
  reschedule: 'Reagendar',
  cancel: 'Cancelar',
  checkin: 'Check-in',
};

export interface BookingPopupProps {
  booking: CalendarBooking;
  role: Role;
  onAction: (kind: BookingActionKind, booking: CalendarBooking) => void;
}

/** Hover card of a booking: details and the actions allowed for the role and status. */
export function BookingPopup({ booking, role, onAction }: BookingPopupProps) {
  const actions = popupActions(booking, role);
  return (
    <div className="space-y-space-sm font-small text-small text-ink">
      <div>
        <p className="font-medium">{booking.fullName}</p>
        <p className="text-ink-muted">
          {booking.roomName} · {booking.code}
        </p>
      </div>
      <p>
        {booking.packageMinutes > 0
          ? `${formatDuration(booking.packageMinutes)} debitadas do pacote`
          : `${formatBRL(booking.paidCents)} de ${formatBRL(booking.totalCents)}`}
      </p>
      <p>{bookingWhen(booking.startsAt, booking.endsAt)}</p>
      {booking.categoryNames.length > 0 ? (
        <p className="text-ink-muted">{booking.categoryNames.join(' · ')}</p>
      ) : null}
      <StatusBadge status={booking.status} />
      {booking.checkedInAt ? (
        <p className="text-ink-muted">Check-in às {formatTimeBR(new Date(booking.checkedInAt))}</p>
      ) : null}
      {actions.length > 0 ? (
        <div className="flex flex-wrap gap-space-xs">
          {actions.map((kind) => (
            <Button
              key={kind}
              size="sm"
              variant={kind === 'cancel' ? 'secondary' : 'primary'}
              onClick={() => {
                onAction(kind, booking);
              }}
            >
              {LABELS[kind]}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
