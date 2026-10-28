import { randomUUID } from 'node:crypto';
import type { ChargeIntent, Cents } from '@bravo/core';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Db, Tx } from '../../db/client';
import {
  bookings,
  charges,
  consents,
  paymentCustomers,
  rooms,
  savedCards,
  users,
} from '../../db/schema';
import type { BookingRow, ChargeRow } from '../../extensions/registry';
import type { RequestContext } from '../../lib/audit';
import { AppError, conflict, notFound } from '../../lib/errors';
import { logger } from '../../lib/logger';
import type { RequestMeta } from '../../lib/request-meta';
import { GatewayError, type ChargeResult, type ProviderId } from '../../payments/gateway';
import { activeProvider, resolveGateway, resolveGatewayForCharge } from '../../payments/resolver';
import type { AppDeps } from '../../types';
import { applyProviderStatus } from './payment-effects.service';

/** What the payment services need from the app; jobs build the same shape. */
export type PaymentDeps = Pick<AppDeps, 'db' | 'env' | 'fetch' | 'now' | 'registry' | 'webPush'>;

export type ChargePurpose = ChargeRow['purpose'];
export type PayMethod = 'pix' | 'card' | 'saved_card';

export interface CreateChargeParams {
  purpose: ChargePurpose;
  userId: string;
  /** Charges of other features (subscriptions, extra hours) have no booking (NUC-209). */
  bookingId?: string | null;
  amountCents: Cents;
  method: PayMethod;
  savedCardId?: string;
  /** Pix and hosted-card expiry; equals the booking hold (AD-034). */
  expiresAt: Date;
  /** Defaults to the active gateway; a saved card always uses its own provider. */
  provider?: ProviderId;
  /** Receita charges point at the period or the extra-hours purchase they pay. */
  subscriptionPeriodId?: string | null;
  extraHoursPurchaseId?: string | null;
  /** A deterministic key (e.g. `renewal:<periodId>:<attempt>`); random when omitted. */
  idempotencyKey?: string;
}

const profileIncomplete = () =>
  new AppError(422, 'PROFILE_INCOMPLETE', 'Complete seu cadastro com CPF ou CNPJ para reservar.');

const gatewayError = (message: string) =>
  new AppError(502, 'GATEWAY_ERROR', 'Não foi possível iniciar o pagamento. Tente novamente.', {
    reason: message.slice(0, 200),
  });

/** What the pay endpoints return for a charge (`ChargeIntent`). */
export function chargeIntentOf(charge: ChargeRow): ChargeIntent {
  return {
    chargeId: charge.id,
    method: charge.method as PayMethod,
    status: charge.status as ChargeIntent['status'],
    amountCents: charge.amountCents,
    expiresAt: charge.expiresAt?.toISOString() ?? null,
    pixQrCodeBase64: charge.pixQrCode,
    pixCopyPaste: charge.pixCopyPaste,
    checkoutUrl: charge.checkoutUrl,
  };
}

/** The card must belong to the user and not be deleted; anything else is a 404. */
async function ownedCard(db: Db | Tx, userId: string, cardId: string) {
  const [card] = await db
    .select()
    .from(savedCards)
    .where(
      and(eq(savedCards.id, cardId), eq(savedCards.userId, userId), isNull(savedCards.deletedAt)),
    );
  if (card === undefined) throw notFound('NOT_FOUND', 'Cartão não encontrado');
  return card;
}

/**
 * Writes a `pending` charge in the caller's transaction (NUC-209: works without a booking). The
 * gateway is called later by `submitCharge`, after the transaction committed.
 */
export async function createCharge(
  tx: Tx,
  _ctx: RequestContext,
  params: CreateChargeParams,
): Promise<ChargeRow> {
  let provider = params.provider ?? (await activeProvider(tx));
  let rawLast: unknown = null;
  if (params.method === 'saved_card') {
    if (params.savedCardId === undefined) throw notFound('NOT_FOUND', 'Cartão não encontrado');
    const card = await ownedCard(tx, params.userId, params.savedCardId);
    provider = card.provider as ProviderId;
    rawLast = { savedCardId: card.id };
  }
  const [charge] = await tx
    .insert(charges)
    .values({
      provider,
      purpose: params.purpose,
      method: params.method,
      userId: params.userId,
      bookingId: params.bookingId ?? null,
      subscriptionPeriodId: params.subscriptionPeriodId ?? null,
      extraHoursPurchaseId: params.extraHoursPurchaseId ?? null,
      amountCents: params.amountCents,
      status: 'pending',
      expiresAt: params.expiresAt,
      idempotencyKey: params.idempotencyKey ?? `ch_${randomUUID()}`,
      rawLast,
    })
    .returning();
  if (charge === undefined) throw new Error('createCharge: insert returned no row');
  return charge;
}

const isSubmitted = (charge: ChargeRow) =>
  charge.externalId !== null || charge.checkoutUrl !== null || charge.pixCopyPaste !== null;

async function describeCharge(
  db: Db | Tx,
  charge: ChargeRow,
): Promise<{ description: string; returnUrl: string }> {
  const base = 'Bravô Clinic';
  if (charge.bookingId === null) return { description: `Pagamento ${base}`, returnUrl: '/app' };
  const [booking] = await db
    .select({ code: bookings.code, roomName: rooms.name })
    .from(bookings)
    .innerJoin(rooms, eq(rooms.id, bookings.roomId))
    .where(eq(bookings.id, charge.bookingId));
  const label =
    charge.purpose === 'booking_balance' || charge.purpose === 'booking_difference'
      ? 'Saldo'
      : 'Reserva';
  return {
    description: `${label} ${booking?.code ?? ''} — ${booking?.roomName ?? base}`.trim(),
    returnUrl: `/checkout/${charge.bookingId}`,
  };
}

/** Stores the gateway answer on the charge; `status` stays untouched, `applyProviderStatus` moves it. */
async function recordSubmission(
  db: Db | Tx,
  charge: ChargeRow,
  result: ChargeResult,
  savedCardId: string | null,
  now: Date,
): Promise<ChargeRow> {
  const [updated] = await db
    .update(charges)
    .set({
      externalId: result.externalId,
      pixCopyPaste: result.pixCopyPaste ?? null,
      pixQrCode: result.pixQrCodeBase64 ?? null,
      checkoutUrl: result.checkoutUrl ?? null,
      feeCents: result.feeCents ?? charge.feeCents,
      rawLast: { ...(savedCardId !== null && { savedCardId }), response: result.raw },
      updatedAt: now,
    })
    .where(and(eq(charges.id, charge.id), eq(charges.status, 'pending')))
    .returning();
  return updated ?? charge;
}

/**
 * Calls the gateway for a pending charge, after the creating transaction committed. A provider
 * failure or timeout leaves the charge `pending` (reconciliation decides) and raises 502
 * `GATEWAY_ERROR` (NUC-111). An already submitted charge is returned as it is.
 */
export async function submitCharge(
  deps: PaymentDeps,
  chargeId: string,
  options: { description?: string; returnUrl?: string } = {},
): Promise<ChargeRow> {
  const { db, env } = deps;
  const [charge] = await db.select().from(charges).where(eq(charges.id, chargeId));
  if (charge === undefined) throw notFound();
  if (charge.status !== 'pending' || isSubmitted(charge)) return charge;

  const [user] = await db.select().from(users).where(eq(users.id, charge.userId));
  if (user === undefined) throw notFound();
  const gateway = await resolveGateway(charge.provider as ProviderId, deps);
  const described = await describeCharge(db, charge);
  const description = options.description ?? described.description;
  const returnUrl = new URL(options.returnUrl ?? described.returnUrl, env.APP_BASE_URL).toString();
  const savedCardId = (charge.rawLast as { savedCardId?: string } | null)?.savedCardId ?? null;

  let result: ChargeResult;
  try {
    if (charge.method === 'saved_card') {
      if (savedCardId === null) throw notFound('NOT_FOUND', 'Cartão não encontrado');
      const card = await ownedCard(db, charge.userId, savedCardId);
      const [customer] = await db
        .select()
        .from(paymentCustomers)
        .where(
          and(
            eq(paymentCustomers.userId, charge.userId),
            eq(paymentCustomers.provider, charge.provider),
          ),
        );
      if (customer === undefined) throw notFound('NOT_FOUND', 'Cartão não encontrado');
      result = await gateway.chargeSavedCard({
        chargeId: charge.id,
        idempotencyKey: charge.idempotencyKey,
        amountCents: charge.amountCents,
        description,
        customerId: customer.externalCustomerId,
        cardId: card.externalCardId,
        payerEmail: user.email,
      });
    } else {
      if (user.docType === null || user.docNumber === null) throw profileIncomplete();
      result = await gateway.createCharge({
        chargeId: charge.id,
        idempotencyKey: charge.idempotencyKey,
        method: charge.method === 'pix' ? 'pix' : 'card',
        amountCents: charge.amountCents,
        description,
        payer: {
          email: user.email,
          name: user.name,
          docType: user.docType as 'cpf' | 'cnpj',
          docNumber: user.docNumber,
        },
        expiresAt: charge.expiresAt ?? new Date(deps.now().getTime() + 15 * 60_000),
        returnUrl,
      });
    }
  } catch (error) {
    if (error instanceof GatewayError) {
      logger.error('gateway call failed', {
        chargeId: charge.id,
        provider: charge.provider,
        kind: error.kind,
        message: error.message,
      });
      throw gatewayError(error.message);
    }
    throw error;
  }
  const submitted = await recordSubmission(db, charge, result, savedCardId, deps.now());
  if (result.status === 'pending') return submitted;
  // A saved card answers at once: the status goes through the same effects as a webhook would.
  await applyProviderStatus(deps, {
    provider: charge.provider as ProviderId,
    externalId: submitted.externalId,
    chargeId: charge.id,
    status: result.status,
    amountCents: charge.amountCents,
    feeCents: result.feeCents,
    raw: result.raw,
  });
  const [settled] = await db.select().from(charges).where(eq(charges.id, charge.id));
  return settled ?? submitted;
}

/**
 * Marks a pending charge `cancelled` in the caller's transaction (guarded update). Returns the
 * row when this call cancelled it, so the caller can ask the provider after commit.
 */
export async function cancelCharge(
  tx: Tx,
  _ctx: RequestContext,
  chargeId: string,
): Promise<ChargeRow | null> {
  const [row] = await tx
    .update(charges)
    .set({ status: 'cancelled', updatedAt: sql`now()` })
    .where(and(eq(charges.id, chargeId), eq(charges.status, 'pending')))
    .returning();
  return row ?? null;
}

/** Best-effort provider-side cancel after commit; a failure is logged, never raised. */
export async function cancelAtProvider(deps: PaymentDeps, charge: ChargeRow): Promise<void> {
  if (!isSubmitted(charge)) return;
  try {
    const gateway = await resolveGatewayForCharge(deps, charge);
    await gateway.cancelCharge({ externalId: charge.externalId, chargeId: charge.id });
  } catch (error) {
    logger.error('gateway cancel failed', {
      chargeId: charge.id,
      error: { name: (error as Error).name, message: (error as Error).message },
    });
  }
}

// --- Booking charges -------------------------------------------------------------------------

export interface PayBookingInput {
  bookingId: string;
  /** The authenticated caller; must own the booking. */
  userId: string;
  method: PayMethod;
  savedCardId?: string | undefined;
  acceptPolicy?: boolean | undefined;
  policyVersion?: number | undefined;
}

const HOLDING = ['awaiting_payment', 'pre_reserved'] as const;

async function lockOwnedBooking(tx: Tx, bookingId: string, userId: string): Promise<BookingRow> {
  const [booking] = await tx
    .select()
    .from(bookings)
    .where(and(eq(bookings.id, bookingId), eq(bookings.userId, userId)))
    .for('update');
  if (booking === undefined) throw notFound();
  return booking;
}

/** The deposit (or the full amount) still to pay now; credits already count in `paid_cents`. */
export function payNowOf(booking: Pick<BookingRow, 'depositCents' | 'paidCents'>): Cents {
  return Math.max(0, booking.depositCents - booking.paidCents);
}

/** Cancels the booking's other pending charges of this purpose and reuses a matching one. */
async function reuseOrReplacePending(
  tx: Tx,
  ctx: RequestContext,
  booking: BookingRow,
  purposes: ChargePurpose[],
  wanted: { method: PayMethod; savedCardId?: string | undefined },
  now: Date,
): Promise<{ reuse: ChargeRow | null; replaced: ChargeRow[] }> {
  const pending = await tx
    .select()
    .from(charges)
    .where(
      and(
        eq(charges.bookingId, booking.id),
        inArray(charges.purpose, purposes),
        eq(charges.status, 'pending'),
      ),
    );
  let reuse: ChargeRow | null = null;
  const replaced: ChargeRow[] = [];
  for (const charge of pending) {
    const savedCardId = (charge.rawLast as { savedCardId?: string } | null)?.savedCardId;
    const same =
      charge.method === wanted.method &&
      (wanted.method !== 'saved_card' || savedCardId === wanted.savedCardId) &&
      (charge.expiresAt === null || charge.expiresAt > now) &&
      reuse === null;
    if (same) {
      reuse = charge;
      continue;
    }
    const cancelled = await cancelCharge(tx, ctx, charge.id);
    if (cancelled !== null) replaced.push(cancelled);
  }
  return { reuse, replaced };
}

async function ensurePolicyConsent(
  tx: Tx,
  booking: BookingRow,
  input: PayBookingInput,
  meta: RequestMeta,
  now: Date,
): Promise<void> {
  const [existing] = await tx
    .select({ id: consents.id })
    .from(consents)
    .where(
      and(
        eq(consents.userId, booking.userId),
        eq(consents.kind, 'booking_policy'),
        eq(consents.refType, 'booking'),
        eq(consents.refId, booking.id),
      ),
    );
  if (existing !== undefined) return;
  if (input.acceptPolicy !== true || input.policyVersion === undefined) {
    throw new AppError(
      422,
      'POLICY_ACCEPTANCE_REQUIRED',
      'Aceite a política de reserva para pagar.',
    );
  }
  const frozen = (booking.policySnapshot as Record<string, unknown>)['policy.version'];
  if (input.policyVersion !== frozen) {
    throw conflict('POLICY_CHANGED', 'A política foi atualizada. Revise e aceite novamente.');
  }
  await tx.insert(consents).values({
    userId: booking.userId,
    kind: 'booking_policy',
    version: `policy-v${String(input.policyVersion)}`,
    acceptedAt: now,
    ip: meta.ip,
    userAgent: meta.userAgent,
    refType: 'booking',
    refId: booking.id,
  });
}

async function createOrReuse(
  deps: PaymentDeps,
  ctx: RequestContext,
  input: PayBookingInput,
  rules: {
    purposes: ChargePurpose[];
    check(booking: BookingRow, now: Date): void;
    plan(booking: BookingRow): { purpose: ChargePurpose; amountCents: Cents; expiresAt: Date };
    meta?: RequestMeta;
  },
): Promise<ChargeRow> {
  const now = deps.now();
  const [payer] = await deps.db
    .select({ docNumber: users.docNumber })
    .from(users)
    .where(eq(users.id, input.userId));
  if (payer === undefined) throw notFound();
  if (payer.docNumber === null) throw profileIncomplete();
  // 503 before anything is written when the active gateway has no credentials (NUC-125).
  if (input.method !== 'saved_card') await resolveGatewayForCharge(deps);
  const { charge, replaced } = await deps.db.transaction(async (tx) => {
    const booking = await lockOwnedBooking(tx, input.bookingId, input.userId);
    rules.check(booking, now);
    if (rules.meta !== undefined) await ensurePolicyConsent(tx, booking, input, rules.meta, now);
    const plan = rules.plan(booking);
    const { reuse, replaced } = await reuseOrReplacePending(
      tx,
      ctx,
      booking,
      rules.purposes,
      { method: input.method, savedCardId: input.savedCardId },
      now,
    );
    if (reuse !== null) return { charge: reuse, replaced };
    const created = await createCharge(tx, ctx, {
      purpose: plan.purpose,
      userId: booking.userId,
      bookingId: booking.id,
      amountCents: plan.amountCents,
      method: input.method,
      ...(input.savedCardId !== undefined && { savedCardId: input.savedCardId }),
      expiresAt: plan.expiresAt,
    });
    return { charge: created, replaced };
  });
  for (const old of replaced) await cancelAtProvider(deps, old);
  return submitCharge(deps, charge.id);
}

/**
 * `POST /app/bookings/:id/pay` (NUC-107..NUC-111): the deposit (`booking_deposit`) or the full
 * amount (`booking_full`, full-upfront bookings) of an `awaiting_payment` or `pre_reserved`
 * booking. Same method reuses the pending charge, another method cancels it first.
 */
export function createChargeForBooking(
  deps: PaymentDeps,
  ctx: RequestContext,
  meta: RequestMeta,
  input: PayBookingInput,
): Promise<ChargeRow> {
  return createOrReuse(deps, ctx, input, {
    meta,
    purposes: ['booking_deposit', 'booking_full'],
    check(booking, now) {
      if (booking.status === 'expired') throw hold();
      if (!(HOLDING as readonly string[]).includes(booking.status)) {
        throw conflict('INVALID_TRANSITION', 'A reserva não aguarda pagamento.');
      }
      if (booking.holdExpiresAt !== null && booking.holdExpiresAt <= now) throw hold();
      if (payNowOf(booking) <= 0) {
        throw conflict('INVALID_STATE', 'Não há valor a pagar agora.');
      }
    },
    plan(booking) {
      return {
        purpose: booking.paymentMode === 'full_upfront' ? 'booking_full' : 'booking_deposit',
        amountCents: payNowOf(booking),
        expiresAt: booking.holdExpiresAt ?? new Date(deps.now().getTime() + 15 * 60_000),
      };
    },
  });
}

const hold = () =>
  conflict('HOLD_EXPIRED', 'O tempo para pagamento terminou e o horário foi liberado.');

/**
 * `POST /app/bookings/:id/pay-balance` (NUC-134, NUC-135): the remaining balance of a `confirmed`
 * booking before `balance_due_at`. The purpose is `booking_difference` once a balance or full
 * charge was already approved, else `booking_balance`.
 */
export async function createBalanceChargeForBooking(
  deps: PaymentDeps,
  ctx: RequestContext,
  input: PayBookingInput,
): Promise<ChargeRow> {
  const [paidBefore] = await deps.db
    .select({ id: charges.id })
    .from(charges)
    .where(
      and(
        eq(charges.bookingId, input.bookingId),
        eq(charges.status, 'approved'),
        inArray(charges.purpose, ['booking_balance', 'booking_full']),
      ),
    )
    .limit(1);
  const purpose: ChargePurpose =
    paidBefore === undefined ? 'booking_balance' : 'booking_difference';
  return createOrReuse(deps, ctx, input, {
    purposes: ['booking_balance', 'booking_difference'],
    check(booking, now) {
      if (booking.status !== 'confirmed' || booking.balanceCents <= 0) {
        throw conflict('INVALID_TRANSITION', 'A reserva não tem saldo a pagar.');
      }
      if (booking.balanceDueAt === null || booking.balanceDueAt <= now) {
        throw conflict('INVALID_TRANSITION', 'O prazo para pagar o saldo terminou.');
      }
    },
    plan(booking) {
      return {
        purpose,
        amountCents: booking.balanceCents,
        expiresAt: booking.balanceDueAt ?? deps.now(),
      };
    },
  });
}
