import type {
  CancellationResult,
  Cents,
  HourlyCategory,
  LocalDate,
  PaymentMode,
  PublicCell,
  QuoteLine,
  QuoteRequest,
  QuoteSegment,
  SettingsValues,
  chargeStatusSchema,
} from '@bravo/core';
import type { z } from 'zod';
import type { Db, Tx } from '../db/client';
import type { bookingCategories, bookings, charges } from '../db/schema';
import type { RequestContext } from '../lib/audit';
import { logger } from '../lib/logger';
import { defaultRegistry } from './defaults';

// The seam between núcleo and the later features (AD-033, design.md "Extension registry"):
// receita and gestao register ports in `extensions/index.ts`; núcleo never imports them.

export type BookingRow = typeof bookings.$inferSelect;
export type CategoryRow = typeof bookingCategories.$inferSelect;
export type ChargeRow = typeof charges.$inferSelect;
/** Provider-agnostic charge status (docs/architecture.md section 3.3). */
export type NormalizedStatus = z.infer<typeof chargeStatusSchema>;

export interface QuoteContext {
  db: Db | Tx;
  now: Date;
  user: { id: string; docNumber: string | null } | null;
  room: { id: string; slug: string; name: string };
  date: LocalDate;
  startMinute: number;
  endMinute: number;
  isHoliday: boolean;
  request: QuoteRequest;
  settings: SettingsValues;
  categories: HourlyCategory[];
}

export interface QuoteDraft {
  segments: QuoteSegment[];
  grossCents: Cents;
  discount: {
    source: 'none' | 'coupon' | 'slot_discount';
    cents: Cents;
    label: string | null;
    ref?: unknown;
  };
  extras: { label: string; amountCents: Cents; ref?: unknown }[];
  creditAvailableCents: Cents;
  paymentMode: PaymentMode | null;
  packageDebit: { minutes: number; detail: unknown } | null;
  /** Public-safe per-step data (key = step name), serialized unchanged as `Quote.extensions`. */
  extensions: Record<string, unknown>;
  lines: QuoteLine[];
  notices: string[];
}

/** One step of the quote pipeline; ascending `order`: discount 100, package 200, extras 300, credit 400. */
export interface CheckoutStep {
  name: string;
  order: number;
  /** Pure: no writes. */
  apply(ctx: QuoteContext, draft: QuoteDraft): Promise<QuoteDraft>;
  persist?(tx: Tx, booking: BookingRow, draft: QuoteDraft, ctx: QuoteContext): Promise<void>;
  /** `result` is present on cancellation, so a step can return the credit portion of a refund. */
  release?(
    tx: Tx,
    booking: BookingRow,
    reason: 'expired' | 'cancelled',
    result?: CancellationResult,
  ): Promise<void>;
  onConfirmed?(tx: Tx, booking: BookingRow): Promise<void>;
}

export interface PaymentModeHandler {
  mode: PaymentMode;
  reschedule?(tx: Tx, booking: BookingRow, next: QuoteDraft): Promise<{ payNowCents: Cents }>;
  cancel?(
    tx: Tx,
    booking: BookingRow,
    evaluation: CancellationResult,
  ): Promise<{ minutesReturned: number }>;
}

export interface CreditPort {
  /** `deferred` records the grant in `booking_events.data.creditGrant`; `live` writes real credit lots. */
  mode: 'deferred' | 'live';
  availableCents(db: Db | Tx, userId: string, now: Date): Promise<Cents>;
  grant(
    tx: Tx,
    input: {
      userId: string;
      amountCents: Cents;
      source: 'reschedule_difference' | 'clinic_cancellation';
      refType: 'booking';
      refId: string;
      ctx: RequestContext;
    },
  ): Promise<{ creditLotId: string | null }>;
}

export interface CompensationSummary {
  subscribers: number;
  minutes: number;
  creditCents: Cents;
  fixedOccurrencesCancelled: number;
}

export interface ClosedDayCompensationPort {
  preview(
    db: Db | Tx,
    args: { date: LocalDate; roomIds: string[] | null },
  ): Promise<CompensationSummary>;
  apply(tx: Tx, closedDayIds: string[], ctx: RequestContext): Promise<void>;
}

export interface AvailabilityDecorator {
  decorate(
    db: Db,
    args: { roomId: string; date: LocalDate; cells: PublicCell[] },
  ): Promise<PublicCell[]>;
}

export interface CategoryHandler {
  type: 'hour_package' | 'fixed_schedule';
  schema: z.ZodType;
  toRow(input: unknown): Partial<CategoryRow>;
  /** Checks that need the settings in force (e.g. the slot grid); runs on create and update. */
  validateRow?(tx: Tx, row: typeof bookingCategories.$inferInsert): Promise<void>;
  /** May throw a 409 or queue notices; runs before the update is persisted. */
  onUpdate?(tx: Tx, before: CategoryRow, after: CategoryRow, ctx: RequestContext): Promise<void>;
}

export type ChargePurposeHandled =
  'subscription_initial' | 'subscription_renewal' | 'extra_hours' | 'extra_service';

export interface ChargeHandler {
  onApproved(tx: Tx, ctx: RequestContext, charge: ChargeRow): Promise<void>;
  onFailed(tx: Tx, ctx: RequestContext, charge: ChargeRow, status: NormalizedStatus): Promise<void>;
}

export type StaffEvent =
  | 'new_booking'
  | 'payment_received'
  | 'booking_cancelled'
  | 'pre_reservation_expired'
  | 'payment_issue'
  | 'new_subscription'
  | 'renewal_failed';

export const STAFF_EVENTS: readonly StaffEvent[] = [
  'new_booking',
  'payment_received',
  'booking_cancelled',
  'pre_reservation_expired',
  'payment_issue',
  'new_subscription',
  'renewal_failed',
];

export interface NotificationPort {
  /** `entityId` feeds gestao's dedupe key. */
  notifyStaff(
    event: StaffEvent,
    payload: { entityId: string } & Record<string, unknown>,
  ): Promise<void>;
}

export interface RoomMediaPort {
  photoUrl(storageKey: string): string | null;
}

export interface Registry {
  checkoutSteps: CheckoutStep[];
  paymentModeHandlers: PaymentModeHandler[];
  credits: CreditPort;
  closedDayCompensation: ClosedDayCompensationPort;
  availabilityDecorators: AvailabilityDecorator[];
  categoryHandlers: CategoryHandler[];
  chargeHandlers: Partial<Record<ChargePurposeHandled, ChargeHandler>>;
  notifications: NotificationPort;
  roomMedia: RoomMediaPort;
}

/** Núcleo defaults (NUC-201); `overrides` replace whole fields, steps are sorted by `order`. */
export function createRegistry(overrides: Partial<Registry> = {}): Registry {
  const registry = { ...defaultRegistry(), ...overrides };
  return {
    ...registry,
    checkoutSteps: [...registry.checkoutSteps].sort((a, b) => a.order - b.order),
  };
}

/**
 * Calls the staff notifier after the transaction committed (NUC-205). A notifier error is logged
 * with the request id and swallowed: the request or job succeeds whatever the notifier does.
 */
export async function notifyStaffAfterCommit(
  registry: Pick<Registry, 'notifications'>,
  event: StaffEvent,
  payload: { entityId: string } & Record<string, unknown>,
  ctx: Pick<RequestContext, 'requestId'>,
): Promise<void> {
  try {
    await registry.notifications.notifyStaff(event, payload);
  } catch (error) {
    logger.error('staff notification failed', {
      requestId: ctx.requestId,
      event,
      entityId: payload.entityId,
      error: { name: (error as Error).name, message: (error as Error).message },
    });
  }
}
