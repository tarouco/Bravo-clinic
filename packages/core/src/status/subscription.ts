import { z } from 'zod';
import { InvalidTransitionError } from './booking';

/** Every `subscriptions.status` code (docs/architecture.md section 3.2 plus AD-030). */
export const SUBSCRIPTION_STATUSES = [
  'awaiting_payment',
  'active',
  'suspended',
  'ended',
  'cancelled',
  'switched',
  'expired',
] as const;
export const subscriptionStatusSchema = z.enum(SUBSCRIPTION_STATUSES);
export type SubscriptionStatus = z.infer<typeof subscriptionStatusSchema>;

/** Every `subscription_periods.status` code (AD-030 adds `cancelled`). */
export const PERIOD_STATUSES = [
  'upcoming',
  'awaiting_payment',
  'paid',
  'active',
  'closed',
  'failed',
  'cancelled',
] as const;
export const periodStatusSchema = z.enum(PERIOD_STATUSES);
export type PeriodStatus = z.infer<typeof periodStatusSchema>;

/** `package_ledger.entry_type` codes. */
export const PACKAGE_LEDGER_ENTRY_TYPES = [
  'period_grant',
  'debit',
  'refund',
  'expiry',
  'conversion_in',
  'conversion_out',
  'manual_adjustment',
] as const;
export const packageLedgerEntryTypeSchema = z.enum(PACKAGE_LEDGER_ENTRY_TYPES);
export type PackageLedgerEntryType = z.infer<typeof packageLedgerEntryTypeSchema>;

/** `extra_minutes_ledger.entry_type` codes. */
export const EXTRA_LEDGER_ENTRY_TYPES = [
  'grant',
  'debit',
  'refund',
  'expiry',
  'manual_adjustment',
] as const;
export const extraLedgerEntryTypeSchema = z.enum(EXTRA_LEDGER_ENTRY_TYPES);
export type ExtraLedgerEntryType = z.infer<typeof extraLedgerEntryTypeSchema>;

/** `extra_minute_lots.source` codes. */
export const EXTRA_LOT_SOURCES = ['purchase', 'closed_day_compensation', 'manual'] as const;
export const extraLotSourceSchema = z.enum(EXTRA_LOT_SOURCES);
export type ExtraLotSource = z.infer<typeof extraLotSourceSchema>;

/** `credit_lots.source` codes. */
export const CREDIT_SOURCES = [
  'reschedule_difference',
  'closed_day_compensation',
  'manual',
  'clinic_cancellation',
] as const;
export const creditSourceSchema = z.enum(CREDIT_SOURCES);
export type CreditSource = z.infer<typeof creditSourceSchema>;

/** `coupon_uses.status` codes. */
export const COUPON_USE_STATUSES = ['reserved', 'consumed', 'released'] as const;
export const couponUseStatusSchema = z.enum(COUPON_USE_STATUSES);
export type CouponUseStatus = z.infer<typeof couponUseStatusSchema>;

// REC-60 (AD-030 adds awaiting_payment -> active | expired).
const SUBSCRIPTION_TRANSITIONS: Record<SubscriptionStatus, readonly SubscriptionStatus[]> = {
  awaiting_payment: ['active', 'expired'],
  active: ['active', 'suspended', 'cancelled', 'switched'],
  suspended: ['active', 'ended', 'cancelled'],
  ended: [],
  cancelled: [],
  switched: [],
  expired: [],
};

// REC-61.
const PERIOD_TRANSITIONS: Record<PeriodStatus, readonly PeriodStatus[]> = {
  upcoming: ['awaiting_payment', 'cancelled'],
  awaiting_payment: ['paid', 'active', 'failed', 'cancelled'],
  paid: ['active', 'cancelled'],
  active: ['closed'],
  closed: [],
  failed: [],
  cancelled: [],
};

export function canTransitionSubscription(
  from: SubscriptionStatus,
  to: SubscriptionStatus,
): boolean {
  return SUBSCRIPTION_TRANSITIONS[from].includes(to);
}

export function canTransitionPeriod(from: PeriodStatus, to: PeriodStatus): boolean {
  return PERIOD_TRANSITIONS[from].includes(to);
}

/** Throws `InvalidTransitionError` when `from -> to` is not an allowed subscription transition. */
export function assertSubscriptionTransition(
  from: SubscriptionStatus,
  to: SubscriptionStatus,
): void {
  if (!canTransitionSubscription(from, to)) {
    throw new InvalidTransitionError(from, to, 'subscription');
  }
}
