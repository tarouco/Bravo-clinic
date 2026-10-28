import { notifyStaffAfterCommit, type ChargeRow, type StaffEvent } from '../../extensions/registry';
import type { RequestContext } from '../../lib/audit';
import { logger } from '../../lib/logger';
import { dispatchNotifications } from '../notifications/notifications.service';
import { cancelAtProvider, type PaymentDeps } from '../payments/charges.service';
import { processRefund } from '../payments/refunds.service';

/**
 * Work a booking service queues inside its transaction and runs once the transaction committed:
 * e-mails (with their pushes), staff notices (NUC-205), provider-side charge cancels and refund calls. A failure of
 * any of them is logged and never undoes the committed change.
 */
export interface AfterCommit {
  emailIds: string[];
  staff: { event: StaffEvent; payload: { entityId: string } & Record<string, unknown> }[];
  cancelCharges: ChargeRow[];
  refundIds: string[];
}

export const newAfterCommit = (): AfterCommit => ({
  emailIds: [],
  staff: [],
  cancelCharges: [],
  refundIds: [],
});

export async function flushAfterCommit(
  deps: PaymentDeps,
  fx: AfterCommit,
  ctx: Pick<RequestContext, 'requestId'>,
): Promise<void> {
  await dispatchNotifications(deps, fx.emailIds);
  for (const { event, payload } of fx.staff) {
    await notifyStaffAfterCommit(deps.registry, event, payload, ctx);
  }
  for (const charge of fx.cancelCharges) await cancelAtProvider(deps, charge);
  for (const refundId of fx.refundIds) {
    try {
      await processRefund(deps, refundId, ctx);
    } catch (error) {
      logger.error('refund processing failed', {
        refundId,
        error: { name: (error as Error).name, message: (error as Error).message },
      });
    }
  }
}
