import { randomUUID } from 'node:crypto';
import {
  allocateCredits,
  creditSourceLabel,
  type Cents,
  type CreditSource,
  type CreditsSummary,
} from '@bravo/core';
import { and, asc, desc, eq, gt, inArray, lte, sql } from 'drizzle-orm';
import type { Db, Tx } from '../../db/client';
import { bookings, charges, creditLedger, creditLots } from '../../db/schema';
import type { ChargeRow } from '../../extensions/registry';
import type { RequestContext } from '../../lib/audit';
import { addDaysToInstant } from '../revenue/instants';
import { loadSettings } from '../settings/settings.repo';

// Customer credits in reais (PRD §5.3.5, REC-105..REC-115). Lots are locked `FOR UPDATE` ordered by
// id before every balance change; each change writes its append-only `credit_ledger` row in the
// same transaction. A use is paid through one internal charge (gestao AD-027).

export type CreditLotRow = typeof creditLots.$inferSelect;
type ChargePurpose = ChargeRow['purpose'];

export interface GrantCreditInput {
  userId: string;
  amountCents: Cents;
  source: CreditSource;
  now: Date;
  refType?: string | null;
  refId?: string | null;
  justification?: string | null;
  bookingId?: string | null;
}

/** New lot with `expires_at = now + credits.validity_days` and its `grant` entry (REC-105). */
export async function grantCredit(
  tx: Tx,
  ctx: RequestContext,
  input: GrantCreditInput,
): Promise<CreditLotRow> {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new Error(`grantCredit: invalid amount ${String(input.amountCents)}`);
  }
  const settings = await loadSettings(tx);
  const [lot] = await tx
    .insert(creditLots)
    .values({
      userId: input.userId,
      source: input.source,
      amountCents: input.amountCents,
      remainingCents: input.amountCents,
      expiresAt: addDaysToInstant(input.now, settings['credits.validity_days']),
      refType: input.refType ?? null,
      refId: input.refId ?? null,
      justification: input.justification ?? null,
      createdBy: ctx.actorUserId,
      createdAt: input.now,
    })
    .returning();
  if (lot === undefined) throw new Error('grantCredit: insert returned no row');
  await tx.insert(creditLedger).values({
    lotId: lot.id,
    userId: input.userId,
    entryType: 'grant',
    amountCents: input.amountCents,
    bookingId: input.bookingId ?? null,
    createdBy: ctx.actorUserId,
    createdAt: input.now,
  });
  return lot;
}

/** Sum of `remaining_cents` of the user's lots with `expires_at > now` (REC-106). */
export async function availableCredit(db: Db | Tx, userId: string, now: Date): Promise<Cents> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${creditLots.remainingCents}), 0)` })
    .from(creditLots)
    .where(
      and(
        eq(creditLots.userId, userId),
        gt(creditLots.remainingCents, 0),
        gt(creditLots.expiresAt, now),
      ),
    );
  return Number(row?.total ?? 0);
}

export interface ApplyCreditsInput {
  userId: string;
  /** The payable amount; `min(available, amountCents)` is used. */
  amountCents: Cents;
  purpose: ChargePurpose;
  now: Date;
  bookingId?: string | null;
  periodId?: string | null;
  purchaseId?: string | null;
}

/**
 * Pays up to `amountCents` with the user's credit: unexpired lots by expiry then creation, one
 * approved internal charge and one `use` entry per lot (REC-107). Lots are locked first, so two
 * concurrent uses never exceed the balance (REC-108).
 */
export async function applyCredits(
  tx: Tx,
  ctx: RequestContext,
  input: ApplyCreditsInput,
): Promise<{ usedCents: Cents; chargeId: string | null }> {
  if (input.amountCents <= 0) return { usedCents: 0, chargeId: null };
  const lots = await tx
    .select()
    .from(creditLots)
    .where(
      and(
        eq(creditLots.userId, input.userId),
        gt(creditLots.remainingCents, 0),
        gt(creditLots.expiresAt, input.now),
      ),
    )
    .orderBy(asc(creditLots.id))
    .for('update');
  const allocation = allocateCredits(lots, input.amountCents, input.now);
  const usedCents = allocation.reduce((sum, part) => sum + part.cents, 0);
  if (usedCents === 0) return { usedCents: 0, chargeId: null };

  const [charge] = await tx
    .insert(charges)
    .values({
      provider: 'internal',
      purpose: input.purpose,
      method: 'credit',
      userId: input.userId,
      bookingId: input.bookingId ?? null,
      subscriptionPeriodId: input.periodId ?? null,
      extraHoursPurchaseId: input.purchaseId ?? null,
      amountCents: usedCents,
      status: 'approved',
      approvedAt: input.now,
      idempotencyKey: `credit_${randomUUID()}`,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .returning();
  if (charge === undefined) throw new Error('applyCredits: charge insert returned no row');

  for (const part of allocation) {
    await tx
      .update(creditLots)
      .set({ remainingCents: sql`${creditLots.remainingCents} - ${part.cents}` })
      .where(eq(creditLots.id, part.lotId));
    await tx.insert(creditLedger).values({
      lotId: part.lotId,
      userId: input.userId,
      entryType: 'use',
      amountCents: -part.cents,
      bookingId: input.bookingId ?? null,
      chargeId: charge.id,
      createdBy: ctx.actorUserId,
      createdAt: input.now,
    });
  }
  return { usedCents, chargeId: charge.id };
}

/**
 * Returns `amountCents` of an internal credit charge to the lots it used (REC-109): to the lot
 * itself while it is unexpired, otherwise to a fresh lot of the same source and validity. The
 * charge's `refunded_cents` and status follow. Asking more than the unrefunded part throws.
 */
export async function refundCredit(
  tx: Tx,
  ctx: RequestContext,
  input: { chargeId: string; amountCents: Cents; now: Date },
): Promise<{ refundedCents: Cents; lotIds: string[] }> {
  if (input.amountCents <= 0) return { refundedCents: 0, lotIds: [] };
  const [charge] = await tx
    .select()
    .from(charges)
    .where(eq(charges.id, input.chargeId))
    .for('update');
  if (charge?.method !== 'credit') throw new Error('refundCredit: not a credit charge');
  if (input.amountCents > charge.amountCents - charge.refundedCents) {
    throw new Error('refundCredit: amount exceeds the unrefunded credit');
  }

  // What each lot gave to this charge, minus what was already returned to it.
  const entries = await tx
    .select({
      lotId: creditLedger.lotId,
      amount: creditLedger.amountCents,
      type: creditLedger.entryType,
    })
    .from(creditLedger)
    .where(eq(creditLedger.chargeId, charge.id));
  const owed = new Map<string, Cents>();
  for (const entry of entries) {
    if (entry.type === 'use') owed.set(entry.lotId, (owed.get(entry.lotId) ?? 0) - entry.amount);
  }
  const returned = entries.filter((e) => e.type === 'refund').reduce((s, e) => s + e.amount, 0);
  // Earlier refunds are taken from the first lots in id order, matching the loop below.
  let skip = returned;
  const lotIds = [...owed.keys()].sort();
  const lots = await tx
    .select()
    .from(creditLots)
    .where(inArray(creditLots.id, lotIds))
    .orderBy(asc(creditLots.id))
    .for('update');

  let left = input.amountCents;
  const touched: string[] = [];
  for (const lot of lots) {
    if (left === 0) break;
    let give = owed.get(lot.id) ?? 0;
    const skipped = Math.min(skip, give);
    skip -= skipped;
    give -= skipped;
    const cents = Math.min(give, left);
    if (cents <= 0) continue;
    left -= cents;
    if (lot.expiresAt.getTime() > input.now.getTime()) {
      await tx
        .update(creditLots)
        .set({ remainingCents: sql`${creditLots.remainingCents} + ${cents}` })
        .where(eq(creditLots.id, lot.id));
      await tx.insert(creditLedger).values({
        lotId: lot.id,
        userId: lot.userId,
        entryType: 'refund',
        amountCents: cents,
        bookingId: charge.bookingId,
        chargeId: charge.id,
        createdBy: ctx.actorUserId,
        createdAt: input.now,
      });
      touched.push(lot.id);
    } else {
      const settings = await loadSettings(tx);
      const [fresh] = await tx
        .insert(creditLots)
        .values({
          userId: lot.userId,
          source: lot.source,
          amountCents: cents,
          remainingCents: cents,
          expiresAt: addDaysToInstant(input.now, settings['credits.validity_days']),
          refType: 'credit_lot',
          refId: lot.id,
          createdBy: ctx.actorUserId,
          createdAt: input.now,
        })
        .returning();
      if (fresh === undefined) throw new Error('refundCredit: insert returned no row');
      await tx.insert(creditLedger).values({
        lotId: fresh.id,
        userId: lot.userId,
        entryType: 'refund',
        amountCents: cents,
        bookingId: charge.bookingId,
        chargeId: charge.id,
        createdBy: ctx.actorUserId,
        createdAt: input.now,
      });
      touched.push(fresh.id);
    }
  }
  const refundedCents = input.amountCents - left;
  const totalRefunded = charge.refundedCents + refundedCents;
  await tx
    .update(charges)
    .set({
      refundedCents: totalRefunded,
      status: totalRefunded >= charge.amountCents ? 'refunded' : 'partially_refunded',
      updatedAt: input.now,
    })
    .where(eq(charges.id, charge.id));
  return { refundedCents, lotIds: touched };
}

/** Zeroes lots with `expires_at ≤ now`, one `expiry` entry each (REC-113); re-runs change nothing. */
export async function expireCredits(tx: Tx, now: Date): Promise<number> {
  const due = await tx
    .select()
    .from(creditLots)
    .where(and(gt(creditLots.remainingCents, 0), lte(creditLots.expiresAt, now)))
    .orderBy(asc(creditLots.id))
    .for('update', { skipLocked: true });
  for (const lot of due) {
    await tx.update(creditLots).set({ remainingCents: 0 }).where(eq(creditLots.id, lot.id));
    await tx.insert(creditLedger).values({
      lotId: lot.id,
      userId: lot.userId,
      entryType: 'expiry',
      amountCents: -lot.remainingCents,
      createdAt: now,
    });
  }
  return due.length;
}

const CREDIT_ENTRY_LABELS = {
  use: 'Pagamento com crédito',
  refund: 'Estorno de crédito',
  expiry: 'Expiração',
  manual_adjustment: 'Ajuste manual',
} as const;

export type CreditLotView = CreditsSummary['lots'][number];

export const toCreditLotView = (lot: CreditLotRow): CreditLotView => ({
  id: lot.id,
  source: lot.source as CreditSource,
  label: creditSourceLabel[lot.source as CreditSource],
  amountCents: lot.amountCents,
  remainingCents: lot.remainingCents,
  expiresAt: lot.expiresAt.toISOString(),
});

/** `GET /app/credits` and the staff view of a customer (REC-114): total, lots and ledger. */
export async function listCredits(db: Db | Tx, userId: string, now: Date): Promise<CreditsSummary> {
  const lots = await db
    .select()
    .from(creditLots)
    .where(eq(creditLots.userId, userId))
    .orderBy(asc(creditLots.expiresAt), asc(creditLots.createdAt));
  const ledger = await db
    .select({
      at: creditLedger.createdAt,
      entryType: creditLedger.entryType,
      amountCents: creditLedger.amountCents,
      source: creditLots.source,
      bookingCode: bookings.code,
    })
    .from(creditLedger)
    .innerJoin(creditLots, eq(creditLots.id, creditLedger.lotId))
    .leftJoin(bookings, eq(bookings.id, creditLedger.bookingId))
    .where(eq(creditLedger.userId, userId))
    .orderBy(desc(creditLedger.createdAt), desc(creditLedger.id))
    .limit(100);
  return {
    availableCents: lots
      .filter((lot) => lot.expiresAt.getTime() > now.getTime())
      .reduce((sum, lot) => sum + lot.remainingCents, 0),
    lots: lots.map(toCreditLotView),
    ledger: ledger.map((entry) => {
      const type = entry.entryType as CreditsSummary['ledger'][number]['entryType'];
      return {
        at: entry.at.toISOString(),
        entryType: type,
        label:
          type === 'grant'
            ? creditSourceLabel[entry.source as CreditSource]
            : CREDIT_ENTRY_LABELS[type],
        amountCents: entry.amountCents,
        ...(entry.bookingCode !== null && { bookingCode: entry.bookingCode }),
      };
    }),
  };
}
