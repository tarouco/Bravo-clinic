import {
  businessWindow,
  formatBRL,
  localToUtc,
  minuteToHHMM,
  priceBlockBooking,
  priceHourlyBooking,
  rejectMessage,
  resolveDayType,
  splitPayment,
  validateInterval,
  type BlockCategory,
  type PaymentPlan,
  type Quote,
  type QuoteLine,
  type QuoteRequest,
  type QuoteSegment,
} from '@bravo/core';
import { and, eq, or, sql } from 'drizzle-orm';
import type { Db, Tx } from '../../db/client';
import { bookingCategories } from '../../db/schema';
import type { QuoteContext, QuoteDraft, Registry } from '../../extensions/registry';
import { AppError, notFound } from '../../lib/errors';
import {
  getActiveRoomBySlug,
  gridSettingsOf,
  loadCalendarInputs,
  loadHourlyCategories,
} from '../calendar/calendar.repo';

export interface BuiltQuote {
  ok: true;
  quote: Quote;
  draft: QuoteDraft;
  ctx: QuoteContext;
}
export type QuoteResult = BuiltQuote | { ok: false; error: AppError };

export interface QuoteOptions {
  now: Date;
  user: { id: string; docNumber: string | null } | null;
  registry: Pick<Registry, 'checkoutSteps' | 'credits'>;
  /** Staff may price admin-only categories (NUC-161). */
  includeAdminOnly?: boolean;
  /** A reschedule prices its target as if the booking being moved did not occupy the room. */
  excludeBookingId?: string;
}

const fail = (error: AppError): QuoteResult => ({ ok: false, error });

/** "1h30", "3h", "45min". */
function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${String(rest)}min`;
  return rest === 0 ? `${String(hours)}h` : `${String(hours)}h${String(rest).padStart(2, '0')}`;
}

function segmentLine(segment: QuoteSegment): QuoteLine {
  const range = `${minuteToHHMM(segment.startMinute)}–${minuteToHHMM(segment.endMinute)}`;
  const label =
    segment.rateCentsPerHour === null
      ? `${range} · ${segment.categoryName}`
      : `${range} · ${segment.categoryName} · ${formatDuration(segment.minutes)} × ${formatBRL(segment.rateCentsPerHour)} = ${formatBRL(segment.amountCents)}`;
  return { kind: 'segment', label, amountCents: segment.amountCents };
}

async function loadBlockCategory(
  db: Db | Tx,
  id: string,
  roomId: string,
  includeAdminOnly: boolean,
): Promise<BlockCategory | null> {
  const [row] = await db
    .select()
    .from(bookingCategories)
    .where(
      and(
        eq(bookingCategories.id, id),
        eq(bookingCategories.type, 'block'),
        eq(bookingCategories.status, 'active'),
        includeAdminOnly ? undefined : eq(bookingCategories.visibility, 'public'),
        or(sql`${bookingCategories.roomId} is null`, eq(bookingCategories.roomId, roomId)),
      ),
    );
  if (row === undefined) return null;
  return {
    id: row.id,
    name: row.name,
    weekdays: row.weekdays,
    appliesOnHolidays: row.appliesOnHolidays,
    startMinute: row.startMinute,
    endMinute: row.endMinute,
    fixedPriceCents: row.fixedPriceCents ?? 0,
  };
}

const validation = (path: string, message: string) =>
  new AppError(422, 'VALIDATION_FAILED', 'Dados inválidos', [{ path, message }]);

/**
 * Prices a request without writing anything (NUC-86..NUC-88, NUC-104): validate the interval,
 * price it (hourly segments or a block), run the registered checkout steps by ascending `order`,
 * then split the net amount into sinal and saldo.
 */
export async function buildQuote(
  db: Db | Tx,
  request: QuoteRequest,
  options: QuoteOptions,
): Promise<QuoteResult> {
  const { now, user, registry } = options;
  const room = await getActiveRoomBySlug(db, request.roomSlug);
  if (room === null) return fail(notFound());

  const { date, startMinute, endMinute } = request;
  const inputs = await loadCalendarInputs(db, {
    roomId: room.id,
    from: date,
    to: date,
    now,
    excludeBookingId: options.excludeBookingId,
  });
  const window = businessWindow({
    date,
    roomId: room.id,
    hours: inputs.hours,
    holidays: inputs.holidays,
    closedDays: inputs.closedDays,
  });
  const isHoliday = inputs.holidays.some((h) => h.date === date);
  const settings = inputs.settings;

  let block: BlockCategory | null = null;
  if (request.blockCategoryId !== undefined) {
    block = await loadBlockCategory(
      db,
      request.blockCategoryId,
      room.id,
      options.includeAdminOnly === true,
    );
    const priced = block === null ? null : priceBlockBooking(block, { date, isHoliday });
    if (block === null || priced === null) {
      return fail(validation('blockCategoryId', 'Bloco indisponível para esta data'));
    }
    if (priced.startMinute !== startMinute || priced.endMinute !== endMinute) {
      return fail(
        validation(
          'startMinute',
          `O bloco ${block.name} vai das ${minuteToHHMM(priced.startMinute)} às ${minuteToHHMM(priced.endMinute)}`,
        ),
      );
    }
  }

  const interval = validateInterval({
    date,
    startMinute,
    endMinute,
    window:
      window === null ? null : { openMinute: window.openMinute, closeMinute: window.closeMinute },
    occupied: inputs.occupied.get(date) ?? [],
    settings: gridSettingsOf(settings),
    now,
  });
  if (!interval.ok) {
    return fail(
      new AppError(422, 'SLOT_UNAVAILABLE', rejectMessage(interval.reason), {
        reason: interval.reason,
      }),
    );
  }

  const categories = await loadHourlyCategories(db, {
    includeAdminOnly: options.includeAdminOnly === true,
  });
  const dayType = resolveDayType(date, isHoliday ? [{ date, isClosed: false }] : []);
  let segments: QuoteSegment[];
  let grossCents: number;
  if (block !== null) {
    grossCents = block.fixedPriceCents;
    segments = [
      {
        startMinute,
        endMinute,
        minutes: endMinute - startMinute,
        categoryId: block.id,
        categoryName: block.name,
        dayType,
        rateCentsPerHour: null,
        amountCents: grossCents,
      },
    ];
  } else {
    const priced = priceHourlyBooking({ date, startMinute, endMinute, isHoliday, categories });
    if (!priced.ok) {
      return fail(
        new AppError(422, 'NO_CATEGORY', 'Horário sem categoria de preço.', {
          uncovered: priced.uncovered,
        }),
      );
    }
    segments = priced.segments;
    grossCents = priced.grossCents;
  }

  const ctx: QuoteContext = {
    db,
    now,
    user,
    room: { id: room.id, slug: room.slug, name: room.name },
    date,
    startMinute,
    endMinute,
    isHoliday,
    request,
    settings,
    categories,
  };
  let draft: QuoteDraft = {
    segments,
    grossCents,
    discount: { source: 'none', cents: 0, label: null },
    extras: [],
    creditAvailableCents:
      user === null ? 0 : await registry.credits.availableCents(db, user.id, now),
    paymentMode: null,
    packageDebit: null,
    extensions: {},
    lines: [],
    notices: [],
  };
  for (const step of [...registry.checkoutSteps].sort((a, b) => a.order - b.order)) {
    draft = await step.apply(ctx, draft);
  }

  const extrasCents = draft.extras.reduce((sum, extra) => sum + extra.amountCents, 0);
  const netCents = draft.grossCents - draft.discount.cents + extrasCents;
  const startsAt = localToUtc(date, startMinute);
  const split = splitPayment({
    netCents,
    creditCents: request.useCredits === true ? draft.creditAvailableCents : 0,
    startsAt,
    now,
    policy: {
      depositPercent: settings['payment.deposit_percent'],
      balanceChargeHoursBefore: settings['payment.balance_charge_hours_before'],
      balanceDeadlineHoursBefore: settings['payment.balance_deadline_hours_before'],
      fullUpfrontThresholdHours: settings['payment.full_upfront_threshold_hours'],
    },
  });
  const payment: PaymentPlan =
    draft.paymentMode === null || draft.paymentMode === split.mode
      ? {
          mode: split.mode,
          depositCents: split.depositCents,
          balanceCents: split.balanceCents,
          payNowCents: split.payNowCents,
          creditUsedCents: split.creditUsedCents,
          balanceChargeAt: split.balanceChargeAt?.toISOString() ?? null,
          balanceDueAt: split.balanceDueAt?.toISOString() ?? null,
        }
      : {
          mode: draft.paymentMode,
          depositCents: 0,
          balanceCents: 0,
          payNowCents: 0,
          creditUsedCents: 0,
          balanceChargeAt: null,
          balanceDueAt: null,
        };

  const lines: QuoteLine[] = [...draft.segments.map(segmentLine), ...draft.lines];
  if (draft.discount.cents > 0) {
    lines.push({
      kind: 'discount',
      label: draft.discount.label ?? 'Desconto',
      amountCents: -draft.discount.cents,
    });
  }
  for (const extra of draft.extras) {
    lines.push({ kind: 'extra', label: extra.label, amountCents: extra.amountCents });
  }
  if (payment.creditUsedCents > 0) {
    lines.push({
      kind: 'credit',
      label: 'Crédito aplicado',
      amountCents: -payment.creditUsedCents,
    });
  }
  lines.push({ kind: 'total', label: 'Total', amountCents: netCents });
  lines.push({
    kind: 'deposit',
    label:
      payment.mode === 'full_upfront'
        ? 'Pagamento integral agora'
        : `Sinal (${String(settings['payment.deposit_percent'])}%)`,
    amountCents: payment.depositCents,
  });
  if (payment.balanceCents > 0) {
    lines.push({ kind: 'balance', label: 'Saldo', amountCents: payment.balanceCents });
  }

  const quote: Quote = {
    roomId: room.id,
    roomSlug: room.slug,
    roomName: room.name,
    date,
    startMinute,
    endMinute,
    durationMinutes: endMinute - startMinute,
    blockCategoryId: block?.id ?? null,
    segments: draft.segments,
    grossCents: draft.grossCents,
    discount: {
      source: draft.discount.source,
      cents: draft.discount.cents,
      label: draft.discount.label,
    },
    extrasCents,
    netCents,
    creditAvailableCents: draft.creditAvailableCents,
    payment,
    policyVersion: settings['policy.version'],
    holdMinutes: settings['payment.checkout_hold_minutes'],
    lines,
    notices: draft.notices,
    extensions: draft.extensions,
  };
  return { ok: true, quote, draft, ctx };
}
