import type { BookingSummary } from '@bravo/core';
import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { StatusBadge } from '../../components/booking/StatusBadge';
import { cx, focusRing } from '../../components/ui/cx';
import { Icon } from '../../components/ui/Icon';
import { bookingWhen } from '../../lib/booking-time';
import { photoSrcSet } from '../../lib/room-photo';
import { useRoomCover } from './room-cover';

/** Rounded room thumbnail (`radius-sm`) of a booking row. */
export function RoomThumb({ slug, className }: { slug: string; className?: string }) {
  const cover = useRoomCover(slug);
  return (
    <img
      src={cover.src}
      srcSet={photoSrcSet(cover.src)}
      sizes="56px"
      alt=""
      loading="lazy"
      className={cx('h-14 w-14 shrink-0 rounded-sm object-cover shadow-lift-1', className)}
    />
  );
}

/**
 * One booking of "Minhas reservas" and the app home: a pearl row (`radius-md`) with the room
 * thumbnail, room, when, code, status and payment.
 */
export function BookingRow({ booking }: { booking: BookingSummary }) {
  return (
    <li className="list-none">
      <Link
        to={`/app/minhas-reservas/${booking.id}`}
        className={cx(
          'flex items-center gap-space-md rounded-md bg-surface-raised p-space-sm pr-space-md text-ink shadow-card transition-transform duration-200 hover:-translate-y-0.5',
          focusRing,
        )}
      >
        <RoomThumb slug={booking.roomSlug} />
        <span className="min-w-0 flex-1 space-y-1">
          <span className="block font-heading-mobile text-body text-ink">{booking.roomName}</span>
          <span className="block font-caption text-caption text-ink-muted">
            {bookingWhen(booking.startsAt, booking.endsAt)}
          </span>
          <span className="block font-caption text-caption text-ink-muted">{booking.code}</span>
          <StatusBadge
            status={booking.status}
            paymentStatus={booking.paymentStatus}
            className="flex flex-wrap items-center gap-space-xs pt-1"
          />
        </span>
        <Icon as={ChevronRight} size={18} className="shrink-0 text-ink-muted" />
      </Link>
    </li>
  );
}
