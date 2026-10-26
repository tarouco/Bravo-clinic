import type { Cents } from '@bravo/core';
import { and, asc, eq, lt, sql } from 'drizzle-orm';
import type { Tx } from '../../db/client';
import { bookings, charges, refunds } from '../../db/schema';
import { notifyStaffAfterCommit } from '../../extensions/registry';
import type { RequestContext } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { resolveGatewayForCharge } from '../../payments/resolver';
import type { PaymentDeps } from './charges.service';

export type RefundRow = typeof refunds.$inferSelect;
export type RefundReason = 'tenant_cancel' | 'clinic_cancel' | 'late_approval_conflict' | 'manual';

/** A refund that fails this many times becomes `failed` and raises `payment_issue`. */
export const MAX_REFUND_ATTEMPTS = 5;
const MAX_ERROR_LENGTH = 500;

const REFUNDABLE = ['approved', 'partially_refunded'];

/**
 * Writes a `pending` refund in the caller's transaction (NUC-119); the gateway is called after
 * commit by `processRefund`. The charge is locked, so concurrent requests cannot refund more than
 * was paid.
 */
export async function requestRefund(
  tx: Tx,
  input: { chargeId: string; amountCents: Cents; reason: RefundReason; ctx: RequestContext },
): Promise<RefundRow> {
  const [charge] = await tx
    .select()
    .from(charges)
    .where(eq(charges.id, input.chargeId))
    .for('update');
  if (charge === undefined) throw notFound();
  if (!REFUNDABLE.includes(charge.status)) {
    throw new AppError(409, 'INVALID_STATE', 'Este pagamento não pode ser reembolsado.');
  }
  const [pending] = await tx
    .select({ total: sql<number>`coalesce(sum(${refunds.amountCents}), 0)::int` })
    .from(refunds)
    .where(and(eq(refunds.chargeId, charge.id), eq(refunds.status, 'pending')));
  const available = charge.amountCents - charge.refundedCents - (pending?.total ?? 0);
  if (
    !Number.isInteger(input.amountCents) ||
    input.amountCents <= 0 ||
    input.amountCents > available
  ) {
    throw new AppError(422, 'VALIDATION_FAILED', 'Valor de reembolso inválido', [
      { path: 'amountCents', message: 'O valor excede o que pode ser reembolsado' },
    ]);
  }
  const [refund] = await tx
    .insert(refunds)
    .values({
      chargeId: charge.id,
      bookingId: charge.bookingId,
      provider: charge.provider,
      amountCents: input.amountCents,
      reason: input.reason,
      status: 'pending',
      requestedBy: input.ctx.actorUserId,
    })
    .returning();
  if (refund === undefined) throw new Error('requestRefund: insert returned no row');
  return refund;
}

async function recordFailure(
  deps: PaymentDeps,
  refund: RefundRow,
  message: string,
  ctx: Pick<RequestContext, 'requestId'>,
): Promise<RefundRow> {
  const attempts = refund.attempts + 1;
  const exhausted = attempts >= MAX_REFUND_ATTEMPTS;
  const [updated] = await deps.db
    .update(refunds)
    .set({
      attempts,
      lastError: message.slice(0, MAX_ERROR_LENGTH),
      ...(exhausted && { status: 'failed' }),
    })
    .where(and(eq(refunds.id, refund.id), eq(refunds.status, 'pending')))
    .returning();
  if (exhausted && updated !== undefined) {
    await notifyStaffAfterCommit(
      deps.registry,
      'payment_issue',
      { entityId: refund.id, chargeId: refund.chargeId, amountCents: refund.amountCents },
      ctx,
    );
  }
  return updated ?? refund;
}

/**
 * Asks the gateway to refund a pending row, after commit (NUC-119). Success makes the refund
 * `approved` with `completed_at` and moves the charge to `partially_refunded` / `refunded`;
 * a gateway error only bumps `attempts` and `last_error` for the reconcile job, and the fifth
 * failure turns the refund `failed` and notifies staff (`payment_issue`).
 */
export async function processRefund(
  deps: PaymentDeps,
  refundId: string,
  ctx: Pick<RequestContext, 'requestId'> = { requestId: null },
): Promise<RefundRow> {
  const { db } = deps;
  const [refund] = await db.select().from(refunds).where(eq(refunds.id, refundId));
  if (refund === undefined) throw notFound();
  if (refund.status !== 'pending') return refund;
  const [charge] = await db.select().from(charges).where(eq(charges.id, refund.chargeId));
  if (charge === undefined) throw notFound();
  if (charge.externalId === null) {
    return recordFailure(deps, refund, 'Pagamento sem identificador no provedor', ctx);
  }

  let outcome: { externalId: string; status: 'approved' | 'pending' | 'failed' };
  try {
    const gateway = await resolveGatewayForCharge(deps, charge);
    outcome = await gateway.refund({
      externalId: charge.externalId,
      amountCents: refund.amountCents,
      idempotencyKey: `refund:${refund.id}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('refund failed', { refundId: refund.id, chargeId: charge.id, message });
    return recordFailure(deps, refund, message, ctx);
  }
  if (outcome.status === 'failed') {
    return recordFailure(deps, refund, 'Reembolso recusado pelo provedor', ctx);
  }
  if (outcome.status === 'pending') {
    const [updated] = await db
      .update(refunds)
      .set({ externalId: outcome.externalId })
      .where(and(eq(refunds.id, refund.id), eq(refunds.status, 'pending')))
      .returning();
    return updated ?? refund;
  }
  return db.transaction(async (tx) => {
    const [locked] = await tx.select().from(charges).where(eq(charges.id, charge.id)).for('update');
    const [claimed] = await tx
      .update(refunds)
      .set({
        status: 'approved',
        externalId: outcome.externalId,
        attempts: refund.attempts + 1,
        lastError: null,
        completedAt: deps.now(),
      })
      .where(and(eq(refunds.id, refund.id), eq(refunds.status, 'pending')))
      .returning();
    // Another worker finished it first: nothing more to write.
    if (claimed === undefined || locked === undefined) return refund;
    const refundedCents = locked.refundedCents + refund.amountCents;
    await tx
      .update(charges)
      .set({
        refundedCents,
        status: refundedCents >= locked.amountCents ? 'refunded' : 'partially_refunded',
        updatedAt: sql`now()`,
      })
      .where(eq(charges.id, locked.id));
    // The conflict refund of a late approval never counted in the booking's paid amount.
    if (refund.bookingId !== null && refund.reason !== 'late_approval_conflict') {
      await tx
        .update(bookings)
        .set({
          paidCents: sql`greatest(${bookings.paidCents} - ${refund.amountCents}, 0)`,
          updatedAt: sql`now()`,
        })
        .where(eq(bookings.id, refund.bookingId));
    }
    return claimed;
  });
}

/** Retries every pending refund that still has attempts left (reconcile job, NUC-119). */
export async function processPendingRefunds(
  deps: PaymentDeps,
): Promise<{ processed: number; approved: number; failed: number }> {
  const pending = await deps.db
    .select({ id: refunds.id })
    .from(refunds)
    .where(and(eq(refunds.status, 'pending'), lt(refunds.attempts, MAX_REFUND_ATTEMPTS)))
    .orderBy(asc(refunds.createdAt));
  const stats = { processed: 0, approved: 0, failed: 0 };
  for (const { id } of pending) {
    const result = await processRefund(deps, id);
    stats.processed += 1;
    if (result.status === 'approved') stats.approved += 1;
    if (result.status === 'failed') stats.failed += 1;
  }
  return stats;
}
