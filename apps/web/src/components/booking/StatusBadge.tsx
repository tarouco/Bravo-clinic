import { bookingStatusLabel, type BookingStatus, type PaymentStatusCode } from '@bravo/core';
import { Badge, type BadgeTone } from '../ui/Badge';

const TONES: Record<BookingStatus, BadgeTone> = {
  awaiting_payment: 'gold',
  pre_reserved: 'gold',
  held_for_renewal: 'gold',
  confirmed: 'emerald',
  paid: 'emerald',
  completed: 'neutral',
  no_show: 'danger',
  expired: 'neutral',
  cancelled_by_tenant: 'danger',
  cancelled_nonpayment: 'danger',
  cancelled_by_clinic: 'danger',
};

export interface StatusBadgeProps {
  status: BookingStatus;
  /** Payment status from the API; shown as a second chip unless its code is `none`. */
  paymentStatus?: { code: PaymentStatusCode; label: string } | undefined;
  className?: string;
}

/** Booking status chip (pt-BR label, color by status) with the payment status beside it. */
export function StatusBadge({ status, paymentStatus, className }: StatusBadgeProps) {
  return (
    <span className={className ?? 'inline-flex flex-wrap items-center gap-space-xs'}>
      <Badge tone={TONES[status]}>{bookingStatusLabel[status]}</Badge>
      {paymentStatus && paymentStatus.code !== 'none' ? (
        <Badge tone="neutral">{paymentStatus.label}</Badge>
      ) : null}
    </span>
  );
}
