import type { ExtraLotSource, PackageLedgerEntryType } from '@bravo/core';
import { and, asc, eq, gt, inArray, lte, sql } from 'drizzle-orm';
import type { Db, Tx } from '../../db/client';
import {
  extraMinuteLots,
  extraMinutesLedger,
  packageLedger,
  subscriptionPeriods,
  subscriptions,
} from '../../db/schema';
import { audit, type RequestContext } from '../../lib/audit';
import { AppError, conflict, notFound, type ErrorDetail } from '../../lib/errors';

// Minute ledgers (REC-32, REC-40, REC-43, REC-44, REC-67): the period balance (`package_ledger`,
// cached in `subscription_periods.minutes_balance`) and the extra-minute lots (`extra_minutes_ledger`,
// cached in `extra_minute_lots.minutes_remaining`). Every change locks its rows `FOR UPDATE` in id
// order, writes the append-only entry and updates the cache in the same transaction.

export type PeriodRow = typeof subscriptionPeriods.$inferSelect;
export type ExtraLotRow = typeof extraMinuteLots.$inferSelect;

/** 422 `INSUFFICIENT_BALANCE` with both numbers (REC-27, REC-44). */
export function insufficientBalance(requiredMinutes: number, availableMinutes: number): AppError {
  const details: (ErrorDetail & { value: number })[] = [
    { path: 'requiredMinutes', message: `${String(requiredMinutes)} min`, value: requiredMinutes },
    {
      path: 'availableMinutes',
      message: `${String(availableMinutes)} min`,
      value: availableMinutes,
    },
  ];
  return new AppError(
    422,
    'INSUFFICIENT_BALANCE',
    `Saldo insuficiente: esta reserva debita ${String(requiredMinutes)} min e você tem ${String(availableMinutes)} min`,
    details,
  );
}

/** The period row, locked for the rest of the transaction. */
export async function lockPeriod(tx: Tx, periodId: string): Promise<PeriodRow> {
  const [period] = await tx
    .select()
    .from(subscriptionPeriods)
    .where(eq(subscriptionPeriods.id, periodId))
    .for('update');
  if (period === undefined) throw notFound('NOT_FOUND', 'Período não encontrado');
  return period;
}

export interface PeriodEntryInput {
  periodId: string;
  entryType: PackageLedgerEntryType;
  /** Signed. */
  minutes: number;
  now: Date;
  bookingId?: string | null;
  detail?: unknown;
}

/**
 * Appends one `package_ledger` entry and moves `minutes_balance` by the same amount. A result below
 * zero is `INSUFFICIENT_BALANCE` and writes nothing. Returns the period after the change.
 */
export async function addPeriodEntry(
  tx: Tx,
  ctx: RequestContext,
  input: PeriodEntryInput,
): Promise<PeriodRow> {
  const period = await lockPeriod(tx, input.periodId);
  if (period.minutesBalance === null) throw new Error('addPeriodEntry: not an hour-package period');
  const after = period.minutesBalance + input.minutes;
  if (after < 0) throw insufficientBalance(-input.minutes, period.minutesBalance);
  const [subscription] = await tx
    .select({ userId: subscriptions.userId })
    .from(subscriptions)
    .where(eq(subscriptions.id, period.subscriptionId));
  if (subscription === undefined) throw new Error('addPeriodEntry: subscription missing');
  await tx.insert(packageLedger).values({
    subscriptionId: period.subscriptionId,
    periodId: period.id,
    userId: subscription.userId,
    entryType: input.entryType,
    minutes: input.minutes,
    bookingId: input.bookingId ?? null,
    detail: input.detail ?? null,
    createdBy: ctx.actorUserId,
    createdAt: input.now,
  });
  const [updated] = await tx
    .update(subscriptionPeriods)
    .set({ minutesBalance: after, updatedAt: input.now })
    .where(eq(subscriptionPeriods.id, period.id))
    .returning();
  if (updated === undefined) throw new Error('addPeriodEntry: update returned no row');
  return updated;
}

type EntryArgs = Omit<PeriodEntryInput, 'entryType' | 'minutes'> & { minutes: number };

/** `period_grant` of the included minutes (at activation, REC-16). */
export const grantPeriod = (tx: Tx, ctx: RequestContext, args: EntryArgs) =>
  addPeriodEntry(tx, ctx, { ...args, entryType: 'period_grant', minutes: Math.abs(args.minutes) });

/** `debit` of a booking; insufficient balance → `INSUFFICIENT_BALANCE` (REC-32). */
export const debitPeriod = (tx: Tx, ctx: RequestContext, args: EntryArgs) =>
  addPeriodEntry(tx, ctx, { ...args, entryType: 'debit', minutes: -Math.abs(args.minutes) });

/** `refund` of a cancelled booking's minutes. */
export const refundPeriod = (tx: Tx, ctx: RequestContext, args: EntryArgs) =>
  addPeriodEntry(tx, ctx, { ...args, entryType: 'refund', minutes: Math.abs(args.minutes) });

/** `expiry` of whatever is left (close, cancel); nothing is written for a zero balance. */
export async function expirePeriod(
  tx: Tx,
  ctx: RequestContext,
  args: { periodId: string; now: Date },
): Promise<{ period: PeriodRow; expiredMinutes: number }> {
  const period = await lockPeriod(tx, args.periodId);
  const balance = period.minutesBalance ?? 0;
  if (balance === 0) return { period, expiredMinutes: 0 };
  const updated = await addPeriodEntry(tx, ctx, {
    periodId: period.id,
    entryType: 'expiry',
    minutes: -balance,
    now: args.now,
  });
  return { period: updated, expiredMinutes: balance };
}

/**
 * Admin adjustment of the active period (REC-43, REC-44): a `manual_adjustment` entry with the
 * justification, audited as `package_ledger.adjust` with the balances before and after.
 */
export async function adjustPeriod(
  tx: Tx,
  ctx: RequestContext,
  args: { periodId: string; minutes: number; justification: string; now: Date },
): Promise<PeriodRow> {
  const before = await lockPeriod(tx, args.periodId);
  if (before.status !== 'active' || before.minutesBalance === null) {
    throw conflict(
      'INVALID_TRANSITION',
      'Só o período ativo de um pacote de horas pode ser ajustado',
    );
  }
  const after = await addPeriodEntry(tx, ctx, {
    periodId: before.id,
    entryType: 'manual_adjustment',
    minutes: args.minutes,
    now: args.now,
    detail: { justification: args.justification },
  });
  await audit(tx, ctx, {
    action: 'package_ledger.adjust',
    entityType: 'subscription_period',
    entityId: before.id,
    justification: args.justification,
    before: { minutesBalance: before.minutesBalance },
    after: { minutesBalance: after.minutesBalance, minutes: args.minutes },
  });
  return after;
}

// ---- Extra-minute lots ----

/** A new lot with its `grant` entry (purchase, closed-day compensation, manual). */
export async function createLot(
  tx: Tx,
  ctx: RequestContext,
  input: {
    userId: string;
    minutes: number;
    source: ExtraLotSource;
    expiresAt: Date;
    now: Date;
    purchaseId?: string | null;
    bookingId?: string | null;
    detail?: unknown;
  },
): Promise<ExtraLotRow> {
  if (!Number.isInteger(input.minutes) || input.minutes <= 0) {
    throw new Error(`createLot: invalid minutes ${String(input.minutes)}`);
  }
  const [lot] = await tx
    .insert(extraMinuteLots)
    .values({
      userId: input.userId,
      source: input.source,
      purchaseId: input.purchaseId ?? null,
      minutesGranted: input.minutes,
      minutesRemaining: input.minutes,
      expiresAt: input.expiresAt,
      createdAt: input.now,
    })
    .returning();
  if (lot === undefined) throw new Error('createLot: insert returned no row');
  await tx.insert(extraMinutesLedger).values({
    lotId: lot.id,
    userId: input.userId,
    entryType: 'grant',
    minutes: input.minutes,
    bookingId: input.bookingId ?? null,
    detail: input.detail ?? null,
    createdBy: ctx.actorUserId,
    createdAt: input.now,
  });
  return lot;
}

/** The user's lots with minutes left and `expires_at > after`, locked in id order. */
export function lockUsableLots(tx: Tx, userId: string, after: Date): Promise<ExtraLotRow[]> {
  return tx
    .select()
    .from(extraMinuteLots)
    .where(
      and(
        eq(extraMinuteLots.userId, userId),
        gt(extraMinuteLots.minutesRemaining, 0),
        gt(extraMinuteLots.expiresAt, after),
      ),
    )
    .orderBy(asc(extraMinuteLots.id))
    .for('update');
}

async function changeLot(
  tx: Tx,
  ctx: RequestContext,
  lot: ExtraLotRow,
  entry: {
    entryType: 'debit' | 'refund' | 'expiry' | 'manual_adjustment';
    minutes: number;
    now: Date;
    bookingId?: string | null;
    detail?: unknown;
  },
): Promise<void> {
  await tx
    .update(extraMinuteLots)
    .set({ minutesRemaining: sql`${extraMinuteLots.minutesRemaining} + ${entry.minutes}` })
    .where(eq(extraMinuteLots.id, lot.id));
  await tx.insert(extraMinutesLedger).values({
    lotId: lot.id,
    userId: lot.userId,
    entryType: entry.entryType,
    minutes: entry.minutes,
    bookingId: entry.bookingId ?? null,
    detail: entry.detail ?? null,
    createdBy: ctx.actorUserId,
    createdAt: entry.now,
  });
}

/**
 * Debits the given minutes from each lot (as chosen by `allocateMinutes`). The lots are locked in
 * id order and re-checked: a lot that no longer covers its part → `INSUFFICIENT_BALANCE`.
 */
export async function debitLots(
  tx: Tx,
  ctx: RequestContext,
  input: {
    parts: { lotId: string; minutes: number }[];
    now: Date;
    bookingId?: string | null;
    detail?: unknown;
  },
): Promise<void> {
  const parts = input.parts.filter((p) => p.minutes > 0);
  if (parts.length === 0) return;
  const lots = await tx
    .select()
    .from(extraMinuteLots)
    .where(
      inArray(
        extraMinuteLots.id,
        parts.map((p) => p.lotId),
      ),
    )
    .orderBy(asc(extraMinuteLots.id))
    .for('update');
  const byId = new Map(lots.map((lot) => [lot.id, lot]));
  const required = parts.reduce((sum, p) => sum + p.minutes, 0);
  const available = lots.reduce((sum, lot) => sum + lot.minutesRemaining, 0);
  for (const part of parts) {
    const lot = byId.get(part.lotId);
    if (lot === undefined || lot.minutesRemaining < part.minutes) {
      throw insufficientBalance(required, available);
    }
  }
  for (const part of [...parts].sort((a, b) => (a.lotId < b.lotId ? -1 : 1))) {
    const lot = byId.get(part.lotId);
    if (lot === undefined) continue;
    await changeLot(tx, ctx, lot, {
      entryType: 'debit',
      minutes: -part.minutes,
      now: input.now,
      bookingId: input.bookingId ?? null,
      detail: input.detail,
    });
  }
}

/** Returns minutes to a lot (`refund` entry); the caller checks the lot has not expired. */
export async function refundLot(
  tx: Tx,
  ctx: RequestContext,
  input: { lotId: string; minutes: number; now: Date; bookingId?: string | null },
): Promise<ExtraLotRow> {
  const [lot] = await tx
    .select()
    .from(extraMinuteLots)
    .where(eq(extraMinuteLots.id, input.lotId))
    .for('update');
  if (lot === undefined) throw notFound('NOT_FOUND', 'Lote de horas extras não encontrado');
  if (lot.minutesRemaining + input.minutes > lot.minutesGranted) {
    throw new Error('refundLot: more than the lot granted');
  }
  await changeLot(tx, ctx, lot, {
    entryType: 'refund',
    minutes: Math.abs(input.minutes),
    now: input.now,
    bookingId: input.bookingId ?? null,
  });
  return { ...lot, minutesRemaining: lot.minutesRemaining + Math.abs(input.minutes) };
}

/** Zeroes lots with `expires_at ≤ now` with an `expiry` entry each (REC-67); a re-run writes 0. */
export async function expireLots(tx: Tx, ctx: RequestContext, now: Date): Promise<number> {
  const due = await tx
    .select()
    .from(extraMinuteLots)
    .where(and(gt(extraMinuteLots.minutesRemaining, 0), lte(extraMinuteLots.expiresAt, now)))
    .orderBy(asc(extraMinuteLots.id))
    .for('update', { skipLocked: true });
  for (const lot of due) {
    await changeLot(tx, ctx, lot, { entryType: 'expiry', minutes: -lot.minutesRemaining, now });
  }
  return due.length;
}

/** Sum of the unexpired extra minutes of a user (summaries and the package option). */
export async function extraMinutesAvailable(db: Db | Tx, userId: string, after: Date) {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${extraMinuteLots.minutesRemaining}), 0)` })
    .from(extraMinuteLots)
    .where(and(eq(extraMinuteLots.userId, userId), gt(extraMinuteLots.expiresAt, after)));
  return Number(row?.total ?? 0);
}
