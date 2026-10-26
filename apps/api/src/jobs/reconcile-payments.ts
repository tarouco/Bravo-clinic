import { and, asc, eq, lte } from 'drizzle-orm';
import { charges } from '../db/schema';
import type { ChargeRow } from '../extensions/registry';
import { logger } from '../lib/logger';
import type { PaymentGateway, ProviderId } from '../payments/gateway';
import { resolveGatewayForCharge } from '../payments/resolver';
import { applyProviderStatus } from '../modules/payments/payment-effects.service';
import { processPendingRefunds } from '../modules/payments/refunds.service';
import type { JobDeps, JobStats } from './runner';

const BATCH = 200;
const REFRESH_AFTER_MS = 2 * 60_000;
const STALE_WITHOUT_EXTERNAL_ID_MS = 10 * 60_000;

/** Tests inject a gateway whose `getStatus` they control. */
export interface ReconcileDeps extends JobDeps {
  gatewayFor?: (charge: ChargeRow) => Promise<PaymentGateway>;
}

/**
 * Payment reconciliation (NUC-198, NUC-119): pending charges older than 2 minutes with a provider
 * id are refreshed through `getStatus` and applied by the same effects as a webhook; one past its
 * `expires_at` that the provider still shows pending becomes `expired`; one that never got a
 * provider id within 10 minutes is cancelled; pending refunds are retried (up to 5 attempts, then
 * `failed` and a `payment_issue` notice, inside `processPendingRefunds`).
 */
export const reconcilePayments = async (deps: ReconcileDeps, now: Date): Promise<JobStats> => {
  const stats = { refreshed: 0, applied: 0, expired: 0, cancelledStale: 0, errors: 0 };
  const pending = await deps.db
    .select()
    .from(charges)
    .where(
      and(
        eq(charges.status, 'pending'),
        lte(charges.createdAt, new Date(now.getTime() - REFRESH_AFTER_MS)),
      ),
    )
    .orderBy(asc(charges.createdAt))
    .limit(BATCH);

  for (const charge of pending) {
    const provider = charge.provider as ProviderId;
    try {
      if (charge.externalId === null) {
        if (charge.createdAt.getTime() <= now.getTime() - STALE_WITHOUT_EXTERNAL_ID_MS) {
          await applyProviderStatus(deps, { provider, chargeId: charge.id, status: 'cancelled' });
          stats.cancelledStale += 1;
        }
        continue;
      }
      const gateway = await (deps.gatewayFor ?? ((c) => resolveGatewayForCharge(deps, c)))(charge);
      const current = await gateway.getStatus({
        externalId: charge.externalId,
        chargeId: charge.id,
      });
      if (current !== null && current.status !== 'pending') {
        await applyProviderStatus(deps, {
          provider,
          externalId: charge.externalId,
          chargeId: charge.id,
          status: current.status,
          feeCents: current.feeCents,
          raw: current.raw,
        });
        stats.applied += 1;
      } else if (charge.expiresAt !== null && charge.expiresAt <= now) {
        await applyProviderStatus(deps, {
          provider,
          externalId: charge.externalId,
          chargeId: charge.id,
          status: 'expired',
        });
        stats.expired += 1;
      } else {
        stats.refreshed += 1;
      }
    } catch (error) {
      stats.errors += 1;
      logger.error('charge reconciliation failed', {
        chargeId: charge.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const refunds = await processPendingRefunds(deps);
  return {
    ...stats,
    refundsProcessed: refunds.processed,
    refundsApproved: refunds.approved,
    refundsFailed: refunds.failed,
  };
};
