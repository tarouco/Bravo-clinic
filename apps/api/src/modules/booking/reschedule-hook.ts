import type { Tx } from '../../db/client';
import type { bookingRescheduleRequests } from '../../db/schema';
import type { RequestContext } from '../../lib/audit';

export type RescheduleRequestRow = typeof bookingRescheduleRequests.$inferSelect;
export type RescheduleCharge = 'approved' | 'failed';

/**
 * Seam between the payment effects (this phase) and the tenant reschedule (Phase 5, T22): a
 * `booking_difference` charge that belongs to a pending `booking_reschedule_requests` row is not
 * applied to the booking by the generic effects; the reschedule service takes over by assigning
 * `apply`. `approved` moves the booking to the held slot, `failed` releases the hold block.
 * Until T22 registers itself a linked charge is only recorded, and the request stays pending.
 */
export const rescheduleRequestHook: {
  apply:
    | ((
        tx: Tx,
        ctx: RequestContext,
        request: RescheduleRequestRow,
        outcome: RescheduleCharge,
      ) => Promise<void>)
    | null;
} = { apply: null };
