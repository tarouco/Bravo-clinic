import type { Tx } from '../../db/client';
import type { bookingRescheduleRequests } from '../../db/schema';
import type { RequestContext } from '../../lib/audit';
import type { PaymentDeps } from '../payments/charges.service';

export type RescheduleRequestRow = typeof bookingRescheduleRequests.$inferSelect;
export type RescheduleCharge = 'approved' | 'failed';

/** What the applier queued for after the payment transaction commits. */
export interface RescheduleApplyEffects {
  emailIds: string[];
  refundIds: string[];
}

export type RescheduleApplier = (
  tx: Tx,
  ctx: RequestContext,
  request: RescheduleRequestRow,
  outcome: RescheduleCharge,
  deps: PaymentDeps,
) => Promise<RescheduleApplyEffects | void>;

/**
 * Seam between the payment effects and the tenant reschedule (AD-032): a `booking_difference`
 * charge that belongs to a reschedule request is not applied to the booking by the generic
 * effects; the reschedule service takes over. `approved` moves the booking to the held slot (or
 * refunds the difference when the slot is gone), `failed` releases the hold block. The service is
 * loaded on first use, which keeps the payment effects free of an import cycle with it. Tests may
 * replace `apply`.
 */
export const rescheduleRequestHook: { apply: RescheduleApplier | null } = {
  apply: async (tx, ctx, request, outcome, deps) => {
    const { applyRescheduleRequest } = await import('./reschedule.service');
    return applyRescheduleRequest(tx, ctx, request, outcome, deps);
  },
};
