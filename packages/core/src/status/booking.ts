import { z } from 'zod';
import type { Cents } from '../money';
import { paymentStatusLabel } from '../labels';

/** Every `bookings.status` code (docs/architecture.md section 3.1). */
export const BOOKING_STATUSES = [
  'awaiting_payment',
  'pre_reserved',
  'held_for_renewal',
  'confirmed',
  'paid',
  'completed',
  'no_show',
  'expired',
  'cancelled_by_tenant',
  'cancelled_nonpayment',
  'cancelled_by_clinic',
] as const;

export const bookingStatusSchema = z.enum(BOOKING_STATUSES);
export type BookingStatus = z.infer<typeof bookingStatusSchema>;

/** Statuses that hold the slot until `hold_expires_at`. */
export const HOLDING_STATUSES = ['awaiting_payment', 'pre_reserved', 'held_for_renewal'] as const;
/** Statuses whose occupancy is active. */
export const ACTIVE_STATUSES = [...HOLDING_STATUSES, 'confirmed', 'paid'] as const;
export const TERMINAL_STATUSES = [
  'completed',
  'no_show',
  'expired',
  'cancelled_by_tenant',
  'cancelled_nonpayment',
  'cancelled_by_clinic',
] as const;
export const CANCELLED_STATUSES = [
  'cancelled_by_tenant',
  'cancelled_nonpayment',
  'cancelled_by_clinic',
] as const;

export const PAYMENT_MODES = [
  'deposit_balance',
  'full_upfront',
  'package',
  'subscription',
  'manual',
] as const;
export const paymentModeSchema = z.enum(PAYMENT_MODES);
export type PaymentMode = z.infer<typeof paymentModeSchema>;

// Architecture section 3.1 plus AD-032: expired -> confirmed | paid (late approval) and
// paid -> confirmed (admin reschedule adding the difference to the balance), plus
// awaiting_payment -> cancelled_by_clinic (PRD 5.5 and 7.5: the clinic may cancel any open booking).
const TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
  awaiting_payment: ['confirmed', 'paid', 'expired', 'cancelled_by_tenant', 'cancelled_by_clinic'],
  pre_reserved: ['confirmed', 'paid', 'expired', 'cancelled_by_clinic'],
  held_for_renewal: ['confirmed', 'cancelled_by_clinic', 'expired'],
  confirmed: [
    'paid',
    'completed',
    'no_show',
    'cancelled_by_tenant',
    'cancelled_nonpayment',
    'cancelled_by_clinic',
  ],
  paid: ['confirmed', 'completed', 'no_show', 'cancelled_by_tenant', 'cancelled_by_clinic'],
  completed: [],
  no_show: [],
  expired: ['confirmed', 'paid'],
  cancelled_by_tenant: [],
  cancelled_nonpayment: [],
  cancelled_by_clinic: [],
};

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Raised by every status machine; `machine` names it in the message (booking by default). */
export class InvalidTransitionError<S extends string = BookingStatus> extends Error {
  readonly from: S;
  readonly to: S;

  constructor(from: S, to: S, machine = 'booking') {
    super(`Invalid ${machine} transition ${from} -> ${to}`);
    this.name = 'InvalidTransitionError';
    this.from = from;
    this.to = to;
  }
}

/** Throws `InvalidTransitionError` when `from -> to` is not an allowed transition. */
export function assertTransition(from: BookingStatus, to: BookingStatus): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

export function isTerminalStatus(status: BookingStatus): boolean {
  return (TERMINAL_STATUSES as readonly BookingStatus[]).includes(status);
}

export const PAYMENT_STATUS_CODES = [
  'awaiting',
  'deposit_paid',
  'manual_pending',
  'paid',
  'package',
  'refunded',
  'none',
] as const;
export const paymentStatusCodeSchema = z.enum(PAYMENT_STATUS_CODES);
export type PaymentStatusCode = z.infer<typeof paymentStatusCodeSchema>;

export interface PaymentStatusInput {
  status: BookingStatus;
  paymentMode: PaymentMode;
  balanceCents: Cents;
  /** Sum of approved refunds. */
  refundedCents: Cents;
}

function codeOf(b: PaymentStatusInput): PaymentStatusCode {
  const cancelled = (CANCELLED_STATUSES as readonly BookingStatus[]).includes(b.status);
  if (cancelled && b.refundedCents > 0) return 'refunded';
  if (b.status === 'awaiting_payment' || b.status === 'pre_reserved') return 'awaiting';
  if (b.paymentMode === 'package' || b.paymentMode === 'subscription') return 'package';
  // An expired or cancelled booking without refunds owes nothing and was not settled: no status.
  if (b.status === 'expired' || cancelled) return 'none';
  if (b.status === 'paid' || b.balanceCents === 0) return 'paid';
  if (b.paymentMode === 'manual') return 'manual_pending';
  if (b.status === 'confirmed' && b.paymentMode === 'deposit_balance') return 'deposit_paid';
  return 'none';
}

/** Payment status shown next to a booking (NUC-03). */
export function paymentStatusOf(b: PaymentStatusInput): { code: PaymentStatusCode; label: string } {
  const code = codeOf(b);
  return { code, label: paymentStatusLabel[code] };
}
