import {
  canTransitionPeriod,
  canTransitionSubscription,
  type PeriodStatus,
  type SubscriptionStatus,
} from '@bravo/core';
import { and, eq } from 'drizzle-orm';
import type { Tx } from '../../db/client';
import { subscriptionPeriods, subscriptions } from '../../db/schema';
import { AppError, notFound } from '../../lib/errors';

// The one door for subscription and period status changes (REC-60, REC-61): the state machine is
// asserted, then a guarded `UPDATE ... WHERE status = <from>` runs, so a repeated webhook or a
// re-run job changes nothing the second time.

export type SubscriptionRow = typeof subscriptions.$inferSelect;
export type PeriodRow = typeof subscriptionPeriods.$inferSelect;

const invalid = (from: string, to: string) =>
  new AppError(409, 'INVALID_TRANSITION', 'Esta assinatura não permite esta ação', { from, to });

export async function lockSubscription(tx: Tx, id: string): Promise<SubscriptionRow> {
  const [row] = await tx.select().from(subscriptions).where(eq(subscriptions.id, id)).for('update');
  if (row === undefined) throw notFound('NOT_FOUND', 'Assinatura não encontrada');
  return row;
}

/** Moves a subscription `from → to`; 409 `INVALID_TRANSITION` when the machine forbids it. */
export async function transitionSubscription(
  tx: Tx,
  id: string,
  from: readonly SubscriptionStatus[],
  to: SubscriptionStatus,
  now: Date,
  patch: Partial<typeof subscriptions.$inferInsert> = {},
): Promise<SubscriptionRow> {
  const current = await lockSubscription(tx, id);
  const status = current.status as SubscriptionStatus;
  if (!from.includes(status) || !canTransitionSubscription(status, to)) throw invalid(status, to);
  const [updated] = await tx
    .update(subscriptions)
    .set({ ...patch, status: to, updatedAt: now })
    .where(and(eq(subscriptions.id, id), eq(subscriptions.status, status)))
    .returning();
  if (updated === undefined) throw invalid(status, to);
  return updated;
}

/** Moves a period `from → to`; 409 `INVALID_TRANSITION` when the machine forbids it. */
export async function transitionPeriod(
  tx: Tx,
  id: string,
  from: readonly PeriodStatus[],
  to: PeriodStatus,
  now: Date,
  patch: Partial<typeof subscriptionPeriods.$inferInsert> = {},
): Promise<PeriodRow> {
  const [current] = await tx
    .select()
    .from(subscriptionPeriods)
    .where(eq(subscriptionPeriods.id, id))
    .for('update');
  if (current === undefined) throw notFound('NOT_FOUND', 'Período não encontrado');
  const status = current.status as PeriodStatus;
  if (!from.includes(status) || !canTransitionPeriod(status, to)) throw invalid(status, to);
  const [updated] = await tx
    .update(subscriptionPeriods)
    .set({ ...patch, status: to, updatedAt: now })
    .where(and(eq(subscriptionPeriods.id, id), eq(subscriptionPeriods.status, status)))
    .returning();
  if (updated === undefined) throw invalid(status, to);
  return updated;
}
