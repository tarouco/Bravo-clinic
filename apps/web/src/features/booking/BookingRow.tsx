import type { BookingSummary } from '@bravo/core';
import { Link } from 'react-router-dom';
import { StatusBadge } from '../../components/booking/StatusBadge';
import { cx, focusRing } from '../../components/ui/cx';
import { bookingWhen } from '../../lib/booking-time';

/** One booking of "Minhas reservas" and the app home: code, room, when, status and payment. */
export function BookingRow({ booking }: { booking: BookingSummary }) {
  return (
    <li className="list-none">
      <Link
        to={`/app/minhas-reservas/${booking.id}`}
        className={cx(
          'flex flex-col gap-space-xs rounded-card border border-hairline bg-surface-raised p-space-md transition-colors hover:border-bronze sm:flex-row sm:items-center sm:justify-between',
          focusRing,
        )}
      >
        <span className="space-y-1">
          <span className="block font-small text-small text-ink-muted">{booking.code}</span>
          <span className="block font-medium text-ink">{booking.roomName}</span>
          <span className="block font-small text-small text-ink-muted">
            {bookingWhen(booking.startsAt, booking.endsAt)}
          </span>
        </span>
        <StatusBadge status={booking.status} paymentStatus={booking.paymentStatus} />
      </Link>
    </li>
  );
}
