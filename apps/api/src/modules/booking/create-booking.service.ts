import { randomBytes, randomUUID } from 'node:crypto';
import {
  localToUtc,
  policySnapshot,
  type BookingStatus,
  type PaymentMode,
  type Quote,
  type QuoteRequest,
} from '@bravo/core';
import { and, eq, inArray, lte, sql } from 'drizzle-orm';
import type { Tx } from '../../db/client';
import {
  bookingEvents,
  bookingSegments,
  bookings,
  consents,
  roomOccupancy,
  users,
} from '../../db/schema';
import type { BookingRow } from '../../extensions/registry';
import type { RequestContext } from '../../lib/audit';
import { audit } from '../../lib/audit';
import { randomToken, sha256Hex } from '../../lib/crypto';
import {
  AppError,
  conflict,
  notFound,
  sqlStateOf,
  uniqueViolationConstraint,
} from '../../lib/errors';
import { appUrl, type RequestMeta } from '../../lib/request-meta';
import { lockCalendarDates } from '../calendar/calendar-lock';
import { SYSTEM_CONTEXT } from '../payments/payment-effects.service';
import type { PaymentDeps } from '../payments/charges.service';
import { bookingMailer, loadBookingMailContext } from './booking-mailer';
import { flushAfterCommit, newAfterCommit, type AfterCommit } from './effects';
import { expireHoldingBooking } from './expire-booking';
import { buildQuote } from './quote.service';

const CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const MAX_AWAITING_HOLDS = 3;
const OCCUPANCY_REASONS = new Set([
  'overlaps_booking',
  'in_cleanup',
  'overlaps_block',
  'no_cleanup_before_next',
]);

/** `BRV-` + 6 base32 characters (NUC-93); 256 is a multiple of 32, so the choice is unbiased. */
export function newBookingCode(): string {
  return `BRV-${Array.from(randomBytes(6), (byte) => CODE_ALPHABET[byte % 32]).join('')}`;
}

const slotTaken = (details?: Record<string, unknown>) =>
  new AppError(409, 'SLOT_TAKEN', 'Este horário acabou de ser reservado.', details);

export type BookingInsert = Omit<typeof bookings.$inferInsert, 'code' | 'icsUid'> & {
  code?: string;
  icsUid?: string;
};

/**
 * Inserts the booking and its occupancy `[start, end + cleanup)` (NUC-94). The exclusion
 * constraint is the one guard against a double booking: a 23P01 becomes 409 `SLOT_TAKEN` naming
 * the start of the occupant that won. A repeated random code is retried.
 */
export async function insertBookingWithOccupancy(tx: Tx, row: BookingInsert): Promise<BookingRow> {
  const until = new Date(row.endsAt.getTime() + row.cleanupMinutes * 60_000);
  const period = `[${row.startsAt.toISOString()},${until.toISOString()})`;
  for (let attempt = 0; ; attempt++) {
    try {
      return await tx.transaction(async (savepoint) => {
        const [booking] = await savepoint
          .insert(bookings)
          .values({
            ...row,
            code: row.code ?? newBookingCode(),
            icsUid: row.icsUid ?? `${randomUUID()}@bravoclinic`,
          })
          .returning();
        if (booking === undefined) throw new Error('insertBookingWithOccupancy: no row');
        await savepoint
          .insert(roomOccupancy)
          .values({ roomId: booking.roomId, period, kind: 'booking', refId: booking.id });
        return booking;
      });
    } catch (error) {
      if (sqlStateOf(error) === '23P01') {
        const [occupant] = await tx
          .select({ start: sql<Date>`lower(${roomOccupancy.period})` })
          .from(roomOccupancy)
          .where(
            and(
              eq(roomOccupancy.roomId, row.roomId),
              eq(roomOccupancy.active, true),
              sql`${roomOccupancy.period} && ${period}::tstzrange`,
            ),
          )
          .limit(1);
        throw slotTaken(
          occupant === undefined
            ? undefined
            : { conflictStartsAt: new Date(occupant.start).toISOString() },
        );
      }
      const constraint = uniqueViolationConstraint(error);
      if (constraint?.includes('code') === true && row.code === undefined && attempt < 4) continue;
      throw error;
    }
  }
}

/** What differs between a customer's own checkout and the bookings staff create for them. */
export type BookingVariant =
  | { type: 'checkout' }
  | { type: 'pre_reservation'; expiresInHours: number }
  | { type: 'manual'; justification: string };

export interface CreateBookingInput {
  userId: string;
  request: QuoteRequest;
  /** Tenant checkout only: the policy version the customer accepted (NUC-91). */
  policyVersion?: number;
  /** Tenant checkout only: the total the customer saw (NUC-92). */
  expectedTotalCents?: number;
}

export interface CreateBookingOptions {
  source: 'web' | 'app' | 'admin' | 'mcp';
  /** Set when staff create the booking for a customer. */
  staff?: { id: string; role: 'admin' | 'reception' };
  variant?: BookingVariant;
  /** Staff bookings carry a payment link token mailed to the customer (NUC-161, NUC-162). */
  paymentLink?: boolean;
  ctx: RequestContext;
  meta?: Pick<RequestMeta, 'ip' | 'userAgent'>;
}

export interface CreatedBooking {
  booking: BookingRow;
  /** Absolute payment link, only when `paymentLink` was requested. */
  paymentLink: string | null;
  quote: Quote;
}

/** Hands out a fresh payment link token and stores only its hash (NUC-164). */
export async function issuePaymentLink(
  tx: Tx,
  deps: Pick<PaymentDeps, 'env'>,
  bookingId: string,
): Promise<string> {
  const token = randomToken();
  await tx
    .update(bookings)
    .set({ paymentLinkTokenHash: sha256Hex(token), updatedAt: sql`now()` })
    .where(eq(bookings.id, bookingId));
  return appUrl(deps.env, `/pre-reserva/${token}`);
}

/** Expires the stale holds that still occupy `[from, until)` so the new occupancy can be inserted (NUC-97). */
async function expireStaleHolds(
  tx: Tx,
  deps: PaymentDeps,
  args: { roomId: string; from: Date; until: Date; now: Date },
  fx: AfterCommit,
): Promise<void> {
  const stale = await tx
    .select({ booking: bookings })
    .from(roomOccupancy)
    .innerJoin(
      bookings,
      and(eq(roomOccupancy.kind, 'booking'), eq(bookings.id, roomOccupancy.refId)),
    )
    .where(
      and(
        eq(roomOccupancy.roomId, args.roomId),
        eq(roomOccupancy.active, true),
        sql`${roomOccupancy.period} && tstzrange(${args.from.toISOString()}::timestamptz, ${args.until.toISOString()}::timestamptz, '[)')`,
        inArray(bookings.status, ['awaiting_payment', 'pre_reserved']),
        eq(bookings.kind, 'single'),
        lte(bookings.holdExpiresAt, args.now),
      ),
    );
  for (const { booking } of stale) {
    await expireHoldingBooking(tx, deps, SYSTEM_CONTEXT, booking, fx);
  }
}

/**
 * Creates a booking and holds its slot (NUC-89..NUC-97, NUC-207). Tenants and staff share the
 * path: the customer's checkout hold, a staff pre-reservation or a manual confirmation differ only
 * in `variant`. Everything runs in one transaction behind the advisory lock of the booking's date,
 * so a closure of that date either lists the booking as affected or sees it rejected as closed
 * (NUC-51). Mail, staff notices and provider calls happen after commit.
 */
export async function createBooking(
  deps: PaymentDeps,
  input: CreateBookingInput,
  options: CreateBookingOptions,
): Promise<CreatedBooking> {
  const { db, registry } = deps;
  const now = deps.now();
  const { ctx } = options;
  const tenantPath = options.staff === undefined;
  const variant: BookingVariant = options.variant ?? { type: 'checkout' };
  const fx = newAfterCommit();

  const created = await db.transaction(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, input.userId));
    if (user === undefined) throw notFound();
    if (tenantPath && user.docNumber === null) {
      throw new AppError(
        422,
        'PROFILE_INCOMPLETE',
        'Complete seu cadastro com CPF ou CNPJ para reservar.',
      );
    }

    if (tenantPath) {
      // One checkout at a time per customer, so the 3-hold count below cannot be raced.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`hold:${user.id}`}))`);
    }
    await lockCalendarDates(tx, [input.request.date]);

    const built = await buildQuote(tx, input.request, {
      now,
      user: { id: user.id, docNumber: user.docNumber },
      registry,
      includeAdminOnly: !tenantPath,
    });
    if (!built.ok) {
      const reason = (built.error.details as { reason?: unknown } | undefined)?.reason;
      if (
        built.error.code === 'SLOT_UNAVAILABLE' &&
        typeof reason === 'string' &&
        OCCUPANCY_REASONS.has(reason)
      ) {
        throw slotTaken({ reason });
      }
      throw built.error;
    }
    const { quote, draft } = built;
    const settings = built.ctx.settings;

    if (tenantPath && !settings['onboarding.prices_reviewed']) {
      throw conflict('BOOKING_NOT_OPEN', 'As reservas online abrem em breve.');
    }
    if (input.policyVersion !== undefined && input.policyVersion !== settings['policy.version']) {
      throw conflict('POLICY_CHANGED', 'A política foi atualizada. Revise e aceite novamente.');
    }
    if (input.expectedTotalCents !== undefined && input.expectedTotalCents !== quote.netCents) {
      throw new AppError(409, 'PRICE_CHANGED', 'O valor mudou. Confira o novo resumo.', { quote });
    }
    if (tenantPath) {
      const [holds] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(bookings)
        .where(
          and(
            eq(bookings.userId, user.id),
            eq(bookings.status, 'awaiting_payment'),
            sql`${bookings.holdExpiresAt} > ${now.toISOString()}::timestamptz`,
          ),
        );
      if ((holds?.total ?? 0) >= MAX_AWAITING_HOLDS) {
        throw new AppError(
          429,
          'TOO_MANY_ATTEMPTS',
          'Você já tem 3 reservas aguardando pagamento.',
        );
      }
    }

    const { date, startMinute, endMinute } = input.request;
    const startsAt = localToUtc(date, startMinute);
    const endsAt = localToUtc(date, endMinute);
    const cleanupMinutes = settings['calendar.cleanup_minutes'];
    await expireStaleHolds(
      tx,
      deps,
      {
        roomId: quote.roomId,
        from: startsAt,
        until: new Date(endsAt.getTime() + cleanupMinutes * 60_000),
        now,
      },
      fx,
    );

    // Money and state. Credits already count as paid; package and subscription bookings carry no
    // money plan (the handler of the mode owns their minutes) and go straight to confirmed.
    const plan = quote.payment;
    const minutesMode = plan.mode === 'package' || plan.mode === 'subscription';
    const manual = variant.type === 'manual';
    const paymentMode: PaymentMode = manual ? 'manual' : plan.mode;
    const creditUsedCents = manual || minutesMode ? 0 : plan.creditUsedCents;
    const remainingCents = manual
      ? quote.netCents
      : minutesMode
        ? 0
        : quote.netCents - creditUsedCents;
    const zeroPayNow = manual || minutesMode || plan.payNowCents === 0;
    let status: BookingStatus;
    if (variant.type === 'pre_reservation') status = 'pre_reserved';
    else if (zeroPayNow)
      status = remainingCents === 0 && !minutesMode && !manual ? 'paid' : 'confirmed';
    else status = 'awaiting_payment';
    const holding = status === 'awaiting_payment' || status === 'pre_reserved';
    const settled = status === 'confirmed' || status === 'paid';
    const holdMs =
      variant.type === 'pre_reservation'
        ? variant.expiresInHours * 3_600_000
        : quote.holdMinutes * 60_000;
    const scheduled = !manual && !minutesMode && status !== 'paid';

    const booking = await insertBookingWithOccupancy(tx, {
      userId: user.id,
      roomId: quote.roomId,
      kind: 'single',
      status,
      source: options.source,
      createdByUserId: options.staff?.id ?? user.id,
      startsAt,
      endsAt,
      cleanupMinutes,
      durationMinutes: quote.durationMinutes,
      paymentMode,
      grossCents: quote.grossCents,
      discountCents: quote.discount.cents,
      discountSource: quote.discount.source,
      totalCents: quote.netCents,
      depositCents: manual || minutesMode ? 0 : plan.depositCents,
      balanceCents: remainingCents,
      paidCents: creditUsedCents,
      creditAppliedCents: creditUsedCents,
      balanceChargeAt: scheduled && plan.balanceChargeAt ? new Date(plan.balanceChargeAt) : null,
      balanceDueAt: scheduled && plan.balanceDueAt ? new Date(plan.balanceDueAt) : null,
      holdExpiresAt: holding ? new Date(now.getTime() + holdMs) : null,
      policySnapshot: policySnapshot(settings),
      confirmedManuallyBy: manual ? (options.staff?.id ?? null) : null,
    });

    await tx.insert(bookingSegments).values(
      quote.segments.map((segment, index) => ({
        bookingId: booking.id,
        seq: index + 1,
        startsAt: localToUtc(date, segment.startMinute),
        endsAt: localToUtc(date, segment.endMinute),
        categoryId: segment.categoryId,
        categoryName: segment.categoryName,
        dayType: segment.dayType,
        rateCentsPerHour: segment.rateCentsPerHour,
        minutes: segment.minutes,
        amountCents: segment.amountCents,
      })),
    );
    if (input.policyVersion !== undefined) {
      await tx.insert(consents).values({
        userId: user.id,
        kind: 'booking_policy',
        version: `policy-v${String(input.policyVersion)}`,
        acceptedAt: now,
        ip: options.meta?.ip ?? null,
        userAgent: options.meta?.userAgent ?? null,
        refType: 'booking',
        refId: booking.id,
      });
    }
    await tx.insert(bookingEvents).values({
      bookingId: booking.id,
      fromStatus: null,
      toStatus: status,
      actorUserId: ctx.actorUserId,
      origin: ctx.origin,
      reason: manual ? 'created_confirmed_manually' : 'created',
      data: { source: options.source, totalCents: quote.netCents },
    });
    for (const step of registry.checkoutSteps) {
      await step.persist?.(tx, booking, draft, built.ctx);
    }

    if (options.staff !== undefined) {
      await audit(tx, ctx, {
        action: manual ? 'booking.confirm_manual' : 'booking.create',
        entityType: 'booking',
        entityId: booking.id,
        ...(variant.type === 'manual' && { justification: variant.justification }),
        after: { code: booking.code, status, source: options.source, userId: user.id },
      });
    }
    let paymentLink: string | null = null;
    if (options.paymentLink === true && !settled) {
      paymentLink = await issuePaymentLink(tx, deps, booking.id);
      const mail = await loadBookingMailContext(tx, booking, deps.env);
      fx.emailIds.push(
        await bookingMailer.preReservationLink(tx, booking, mail, { link: paymentLink }),
      );
    }
    if (settled) {
      for (const step of registry.checkoutSteps) await step.onConfirmed?.(tx, booking);
      const mail = await loadBookingMailContext(tx, booking, deps.env);
      fx.emailIds.push(await bookingMailer.confirmed(tx, booking, mail));
      fx.staff.push({
        event: 'new_booking',
        payload: { entityId: booking.id, code: booking.code },
      });
    }
    return { booking, paymentLink, quote };
  });

  await flushAfterCommit(deps, fx, ctx);
  return created;
}
