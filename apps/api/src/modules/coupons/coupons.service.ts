import {
  couponDiscountCents,
  couponRejectMessage,
  validateCoupon,
  type Cents,
  type Coupon,
  type CouponInput,
  type CouponRejectionReason,
  type CouponRow,
  type CouponUse,
  type CouponUseStatus,
} from '@bravo/core';
import { and, asc, desc, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import type { Db, Tx } from '../../db/client';
import {
  bookingCategories,
  bookingEvents,
  bookings,
  couponUses,
  coupons,
  subscriptions,
  users,
} from '../../db/schema';
import { audit, type RequestContext } from '../../lib/audit';
import { AppError, notFound, uniqueViolationConstraint } from '../../lib/errors';

// Coupons (PRD §5.3.4, REC-116..REC-132). A checkout reserves a use with the atomic counter update
// of docs/architecture.md §5.4, the approval consumes it and an expiry or cancellation before the
// approval releases it (counter − 1). A consumed use never returns.

export type CouponDbRow = typeof coupons.$inferSelect;
export type CouponUseRow = typeof couponUses.$inferSelect;

export const toCoupon = (row: CouponDbRow): Coupon => ({
  id: row.id,
  code: row.code,
  type: row.type as Coupon['type'],
  discountKind: row.discountKind as Coupon['discountKind'],
  discountValue: row.discountValue,
  appliesTo: row.appliesTo as Coupon['appliesTo'],
  maxUses: row.maxUses,
  usesCount: row.usesCount,
  perCustomerLimit: row.perCustomerLimit,
  validFrom: row.validFrom?.toISOString() ?? null,
  validUntil: row.validUntil?.toISOString() ?? null,
  enabled: row.enabled,
});

const duplicateCode = () =>
  new AppError(409, 'CONFLICT', 'Já existe um cupom com este código', [
    { path: 'code', message: 'Já existe um cupom com este código' },
  ]);

/** Admin list, newest first. */
export async function listCoupons(db: Db | Tx): Promise<Coupon[]> {
  const rows = await db.select().from(coupons).orderBy(desc(coupons.createdAt), desc(coupons.id));
  return rows.map(toCoupon);
}

async function lockCoupon(tx: Tx, id: string): Promise<CouponDbRow> {
  const [row] = await tx.select().from(coupons).where(eq(coupons.id, id)).for('update');
  if (row === undefined) throw notFound('NOT_FOUND', 'Cupom não encontrado');
  return row;
}

const rowValues = (input: CouponInput) => ({
  code: input.code,
  type: input.type,
  discountKind: input.discountKind,
  discountValue: input.discountValue,
  appliesTo: input.appliesTo,
  maxUses: input.maxUses,
  perCustomerLimit: input.perCustomerLimit,
  validFrom: input.validFrom === null ? null : new Date(input.validFrom),
  validUntil: input.validUntil === null ? null : new Date(input.validUntil),
  enabled: input.enabled,
});

/** Runs an insert/update and maps the unique code index to 409 CONFLICT on `code` (REC-129). */
async function guardCode<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (uniqueViolationConstraint(error) === 'coupons_code_uq') throw duplicateCode();
    throw error;
  }
}

/** Creates a coupon (code upper-cased by the schema) and audits `coupon.create` (REC-130). */
export async function createCoupon(
  tx: Tx,
  ctx: RequestContext,
  input: CouponInput,
  now: Date,
): Promise<Coupon> {
  const row = await guardCode(async () => {
    const [created] = await tx
      .insert(coupons)
      .values({ ...rowValues(input), createdBy: ctx.actorUserId, createdAt: now, updatedAt: now })
      .returning();
    if (created === undefined) throw new Error('createCoupon: insert returned no row');
    return created;
  });
  await audit(tx, ctx, {
    action: 'coupon.create',
    entityType: 'coupon',
    entityId: row.id,
    after: toCoupon(row),
  });
  return toCoupon(row);
}

/** Edits a coupon; `max_uses` below the current `uses_count` → 422 (REC-129). */
export async function updateCoupon(
  tx: Tx,
  ctx: RequestContext,
  id: string,
  input: CouponInput,
  now: Date,
): Promise<Coupon> {
  const before = await lockCoupon(tx, id);
  if (input.maxUses !== null && input.maxUses < before.usesCount) {
    throw new AppError(422, 'VALIDATION_FAILED', 'Dados inválidos', [
      {
        path: 'maxUses',
        message: `O limite não pode ser menor que os ${String(before.usesCount)} usos já feitos`,
      },
    ]);
  }
  const after = await guardCode(async () => {
    const [updated] = await tx
      .update(coupons)
      .set({ ...rowValues(input), updatedAt: now })
      .where(eq(coupons.id, id))
      .returning();
    if (updated === undefined) throw notFound('NOT_FOUND', 'Cupom não encontrado');
    return updated;
  });
  await audit(tx, ctx, {
    action: 'coupon.update',
    entityType: 'coupon',
    entityId: id,
    before: toCoupon(before),
    after: toCoupon(after),
  });
  return toCoupon(after);
}

/** Enables or disables a coupon, audited as `coupon.enable` / `coupon.disable` (REC-130). */
export async function setCouponEnabled(
  tx: Tx,
  ctx: RequestContext,
  id: string,
  enabled: boolean,
  now: Date,
): Promise<Coupon> {
  const before = await lockCoupon(tx, id);
  const [after] = await tx
    .update(coupons)
    .set({ enabled, updatedAt: now })
    .where(eq(coupons.id, id))
    .returning();
  if (after === undefined) throw notFound('NOT_FOUND', 'Cupom não encontrado');
  await audit(tx, ctx, {
    action: enabled ? 'coupon.enable' : 'coupon.disable',
    entityType: 'coupon',
    entityId: id,
    before: { enabled: before.enabled },
    after: { enabled },
  });
  return toCoupon(after);
}

const LIVE_USE = ['reserved', 'consumed'] as const;
/** Statuses that prove a booking reached `confirmed` (spec assumption "First-booking eligibility"). */
const CONFIRMED_STATUSES = ['confirmed', 'paid', 'completed', 'no_show'] as const;
const CANCELLED_STATUSES = ['cancelled_by_tenant', 'cancelled_nonpayment', 'cancelled_by_clinic'];

/** The customer: the user's own id plus every account holding the same document. */
async function customerScope(db: Db | Tx, userId: string) {
  const [user] = await db
    .select({ docNumber: users.docNumber })
    .from(users)
    .where(eq(users.id, userId));
  const docNumber = user?.docNumber ?? null;
  const userIds =
    docNumber === null
      ? [userId]
      : (await db.select({ id: users.id }).from(users).where(eq(users.docNumber, docNumber))).map(
          (u) => u.id,
        );
  if (!userIds.includes(userId)) userIds.push(userId);
  return { docNumber, userIds };
}

/** Uses of a coupon set that count for the customer: by document when present, else by user. */
function usesOfCustomer(scope: { docNumber: string | null; userIds: string[] }): SQL {
  return scope.docNumber === null
    ? inArray(couponUses.userId, scope.userIds)
    : (or(
        eq(couponUses.docNumber, scope.docNumber),
        inArray(couponUses.userId, scope.userIds),
      ) as SQL);
}

/** REC-118: a booking of the customer reached `confirmed`, or a live first-booking use exists. */
async function customerHasPriorBooking(
  db: Db | Tx,
  scope: { docNumber: string | null; userIds: string[] },
): Promise<boolean> {
  const confirmedOnce = sql`exists (select 1 from ${bookingEvents} e where e.booking_id = ${bookings.id} and e.to_status in ('confirmed','paid'))`;
  const [booking] = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(
      and(
        inArray(bookings.userId, scope.userIds),
        or(
          inArray(bookings.status, [...CONFIRMED_STATUSES]),
          and(inArray(bookings.status, CANCELLED_STATUSES), confirmedOnce),
        ),
      ),
    )
    .limit(1);
  if (booking !== undefined) return true;
  const [use] = await db
    .select({ id: couponUses.id })
    .from(couponUses)
    .innerJoin(coupons, eq(coupons.id, couponUses.couponId))
    .where(
      and(
        eq(coupons.type, 'first_booking'),
        inArray(couponUses.status, [...LIVE_USE]),
        usesOfCustomer(scope),
      ),
    )
    .limit(1);
  return use !== undefined;
}

export type CouponEvaluation =
  | { ok: true; coupon: CouponDbRow; discountCents: Cents }
  | { ok: false; reason: CouponRejectionReason; message: string; coupon: CouponDbRow | null };

/**
 * Validates a code for a booking or a package's first payment (REC-117..REC-119, REC-126) and
 * prices it on `grossCents`. Codes match case-insensitively (REC-127).
 */
export async function evaluateCoupon(
  db: Db | Tx,
  args: {
    code: string;
    userId: string;
    target: 'booking' | 'package';
    grossCents: Cents;
    now: Date;
  },
): Promise<CouponEvaluation> {
  const [row] = await db
    .select()
    .from(coupons)
    .where(eq(coupons.code, args.code.trim().toUpperCase()));
  const coupon = row ?? null;
  const reject = (reason: CouponRejectionReason): CouponEvaluation => ({
    ok: false,
    reason,
    message: couponRejectMessage(reason),
    coupon,
  });
  if (coupon === null) return reject('not_found');

  const scope = await customerScope(db, args.userId);
  const [prior] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(couponUses)
    .where(
      and(
        eq(couponUses.couponId, coupon.id),
        inArray(couponUses.status, [...LIVE_USE]),
        usesOfCustomer(scope),
      ),
    );
  const docHasPriorBooking =
    coupon.type === 'first_booking' ? await customerHasPriorBooking(db, scope) : false;
  const verdict = validateCoupon({
    coupon: coupon as CouponRow,
    now: args.now,
    target: args.target,
    customerPriorUses: prior?.n ?? 0,
    docHasPriorBooking,
  });
  if (!verdict.ok) return reject(verdict.reason);
  return {
    ok: true,
    coupon,
    discountCents: couponDiscountCents(args.grossCents, {
      kind: coupon.discountKind as 'percent' | 'fixed',
      value: coupon.discountValue,
    }),
  };
}

/** 422 COUPON_INVALID for a rejection at checkout (design.md error codes). */
export function couponInvalid(reason: CouponRejectionReason): AppError {
  const message = couponRejectMessage(reason);
  return new AppError(422, 'COUPON_INVALID', message, [
    { path: 'couponCode', message, reason } as { path: string; message: string },
  ]);
}

export const couponExhausted = () => new AppError(409, 'COUPON_EXHAUSTED', 'Cupom esgotado');

/**
 * Reserves one use: `uses_count + 1` only while enabled and below `max_uses` (atomic, REC-123), then
 * a `reserved` use row. The last use raced by two checkouts → the loser gets 409 COUPON_EXHAUSTED.
 */
export async function reserveUse(
  tx: Tx,
  input: {
    couponId: string;
    userId: string;
    discountCents: Cents;
    now: Date;
    bookingId?: string | null;
    subscriptionId?: string | null;
  },
): Promise<CouponUseRow> {
  const [taken] = await tx
    .update(coupons)
    .set({ usesCount: sql`${coupons.usesCount} + 1`, updatedAt: input.now })
    .where(
      and(
        eq(coupons.id, input.couponId),
        eq(coupons.enabled, true),
        sql`(${coupons.maxUses} is null or ${coupons.usesCount} < ${coupons.maxUses})`,
      ),
    )
    .returning({ id: coupons.id });
  if (taken === undefined) {
    const [coupon] = await tx.select().from(coupons).where(eq(coupons.id, input.couponId));
    if (coupon !== undefined && !coupon.enabled) throw couponInvalid('disabled');
    throw couponExhausted();
  }
  const [user] = await tx
    .select({ docNumber: users.docNumber })
    .from(users)
    .where(eq(users.id, input.userId));
  const [use] = await tx
    .insert(couponUses)
    .values({
      couponId: input.couponId,
      userId: input.userId,
      docNumber: user?.docNumber ?? null,
      bookingId: input.bookingId ?? null,
      subscriptionId: input.subscriptionId ?? null,
      discountCents: input.discountCents,
      status: 'reserved',
      createdAt: input.now,
      updatedAt: input.now,
    })
    .returning();
  if (use === undefined) throw new Error('reserveUse: insert returned no row');
  return use;
}

export type UseRef = { useId: string } | { bookingId: string } | { subscriptionId: string };

function refWhere(ref: UseRef): SQL {
  if ('useId' in ref) return eq(couponUses.id, ref.useId);
  if ('bookingId' in ref) return eq(couponUses.bookingId, ref.bookingId);
  return eq(couponUses.subscriptionId, ref.subscriptionId);
}

/** reserved → consumed (on approval); the counter stays. Returns the consumed uses. */
export async function consumeUse(tx: Tx, ref: UseRef, now: Date): Promise<CouponUseRow[]> {
  return tx
    .update(couponUses)
    .set({ status: 'consumed', updatedAt: now })
    .where(and(refWhere(ref), eq(couponUses.status, 'reserved')))
    .returning();
}

/**
 * reserved → released (expiry or cancellation before approval) and `uses_count − 1`. A consumed use
 * is never released. Returns the released uses.
 */
export async function releaseUse(tx: Tx, ref: UseRef, now: Date): Promise<CouponUseRow[]> {
  const released = await tx
    .update(couponUses)
    .set({ status: 'released', updatedAt: now })
    .where(and(refWhere(ref), eq(couponUses.status, 'reserved')))
    .returning();
  for (const couponId of [...new Set(released.map((u) => u.couponId))].sort()) {
    const count = released.filter((u) => u.couponId === couponId).length;
    await tx
      .update(coupons)
      .set({ usesCount: sql`greatest(${coupons.usesCount} - ${count}, 0)`, updatedAt: now })
      .where(eq(coupons.id, couponId));
  }
  return released;
}

/** A coupon's history (REC-131), newest first. */
export async function listUses(db: Db | Tx, couponId: string): Promise<CouponUse[]> {
  const [coupon] = await db
    .select({ id: coupons.id })
    .from(coupons)
    .where(eq(coupons.id, couponId));
  if (coupon === undefined) throw notFound('NOT_FOUND', 'Cupom não encontrado');
  const rows = await db
    .select({
      id: couponUses.id,
      at: couponUses.createdAt,
      customerName: users.name,
      bookingCode: bookings.code,
      category: bookingCategories.name,
      discountCents: couponUses.discountCents,
      status: couponUses.status,
    })
    .from(couponUses)
    .innerJoin(users, eq(users.id, couponUses.userId))
    .leftJoin(bookings, eq(bookings.id, couponUses.bookingId))
    .leftJoin(subscriptions, eq(subscriptions.id, couponUses.subscriptionId))
    .leftJoin(bookingCategories, eq(bookingCategories.id, subscriptions.categoryId))
    .where(eq(couponUses.couponId, couponId))
    .orderBy(desc(couponUses.createdAt), asc(couponUses.id));
  return rows.map((row) => ({
    id: row.id,
    at: row.at.toISOString(),
    customerName: row.customerName,
    ...(row.bookingCode !== null && { bookingCode: row.bookingCode }),
    ...(row.category !== null && { subscriptionCategory: row.category }),
    discountCents: row.discountCents,
    status: row.status as CouponUseStatus,
  }));
}
