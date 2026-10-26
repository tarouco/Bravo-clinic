import { bookingStatusLabel, type AffectedBooking } from '@bravo/core';
import { Link } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { bookingWhen } from '../../lib/booking-time';

export interface AffectedBookingsModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** What the API said and what to do next. */
  message: string;
  bookings: readonly AffectedBooking[];
}

/**
 * Bookings that block a calendar change (409 `AFFECTED_BOOKINGS` / `CLEANUP_CONFLICTS`), each
 * linking to the bookings list filtered by its code so staff can move or cancel it (NUC-41).
 */
export function AffectedBookingsModal({
  open,
  onClose,
  title,
  message,
  bookings,
}: AffectedBookingsModalProps) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="space-y-space-md">
        <p className="font-small text-small text-ink">{message}</p>
        {bookings.length > 0 ? (
          <ul aria-label="Reservas afetadas" className="space-y-space-sm">
            {bookings.map((booking) => (
              <li
                key={booking.id}
                className="rounded-control border border-hairline bg-surface-stone p-space-sm font-small text-small"
              >
                <div className="flex flex-wrap items-center gap-space-sm">
                  <Link
                    to={`/admin/reservas/lista?q=${encodeURIComponent(booking.code)}`}
                    className="font-medium text-bronze underline underline-offset-4"
                  >
                    {booking.code}
                  </Link>
                  <Badge tone="neutral">{bookingStatusLabel[booking.status]}</Badge>
                </div>
                <p className="text-ink">
                  {booking.customerName} · {booking.roomName}
                </p>
                <p className="text-ink-muted">{bookingWhen(booking.startsAt, booking.endsAt)}</p>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            Entendi
          </Button>
        </div>
      </div>
    </Modal>
  );
}
