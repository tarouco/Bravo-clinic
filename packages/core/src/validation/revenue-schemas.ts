import { z } from 'zod';
import type { LocalDate } from '../time';
import {
  bookingCodeSchema,
  centsSchema,
  chargeIntentSchema,
  chargeMethodSchema,
  chargePurposeSchema,
  chargeStatusSchema,
  discountSourceSchema,
  idSchema,
  instantSchema,
  justificationSchema,
  localDateSchema,
  minuteOfDaySchema,
  payMethodSchema,
  positiveCentsSchema,
  weekdaysSchema,
} from '../contracts/common';
import { categoryStatusSchema, categoryVisibilitySchema } from '../contracts/admin';
import {
  couponUseStatusSchema,
  creditSourceSchema,
  extraLotSourceSchema,
  PACKAGE_LEDGER_ENTRY_TYPES,
  periodStatusSchema,
  subscriptionStatusSchema,
} from '../status/subscription';

// Receita request and response contracts (design.md "@bravo/core" and "API Contracts", AD-024,
// AD-035). Request schemas carry pt-BR messages; response schemas are parsed by API route tests
// and web fixtures so both lanes share one contract.

// ---- Shared vocabulary ----

export const packageTypeSchema = z.enum(['hour_package', 'fixed_schedule']);
export type PackageType = z.infer<typeof packageTypeSchema>;
export const packagePeriodSchema = z.enum(['monthly', 'bimonthly', 'quarterly'], {
  error: 'Escolha o período: mensal, bimestral ou trimestral',
});
export type PackagePeriod = z.infer<typeof packagePeriodSchema>;
export const periodDaysSchema = z.union([z.literal(30), z.literal(60), z.literal(90)]);

const minutesSchema = z.number().int().nonnegative();
const countSchema = z.number().int().nonnegative();

export const COUPON_CODE_MESSAGE = 'Código inválido: use de 3 a 30 letras, números, _ ou -';

/** Admin coupon code: trimmed, upper-cased, `^[A-Z0-9_-]{3,30}$` (REC-127, REC-129). */
export const couponCodeSchema = z
  .string({ error: 'Informe o código do cupom' })
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9_-]{3,30}$/, { error: COUPON_CODE_MESSAGE });

/**
 * Coupon code typed at checkout: trimmed and upper-cased. An unknown or malformed code is not a
 * validation error; the quote answers it with `couponRejection` `not_found` (REC-117).
 */
export const checkoutCouponCodeSchema = z
  .string({ error: 'Informe o código do cupom' })
  .trim()
  .toUpperCase()
  .min(1, { error: 'Informe o código do cupom' })
  .max(40, { error: 'Informe o código do cupom' });

const packageNameSchema = z
  .string({ error: 'Informe o nome da categoria' })
  .trim()
  .min(2, { error: 'Informe o nome da categoria' })
  .max(80, { error: 'Use no máximo 80 caracteres' });

const savedCardRequired = (r: { paymentMethod: string; savedCardId?: string | undefined }) =>
  r.paymentMethod !== 'saved_card' || r.savedCardId !== undefined;
const savedCardRefinement = { error: 'Escolha o cartão salvo', path: ['savedCardId'] };

function formatLocalDateBR(date: LocalDate): string {
  const [year, month, day] = date.split('-');
  return `${day ?? ''}/${month ?? ''}/${year ?? ''}`;
}

/** REC-11 message: "Escolha uma data base entre 25/10/2026 e 23/01/2027". */
export function baseOnRangeMessage(today: LocalDate, limit: LocalDate): string {
  return `Escolha uma data base entre ${formatLocalDateBR(today)} e ${formatLocalDateBR(limit)}`;
}

// ---- Package categories (REC-01, REC-02) ----

/** Hour package: whole hours 1..200 stored as `includedMinutes = hours × 60` (REC-01). */
export const hourPackageCategoryInput = z
  .object({
    type: z.literal('hour_package'),
    name: packageNameSchema,
    fixedPriceCents: positiveCentsSchema,
    includedHours: z
      .number({ error: 'Informe as horas incluídas' })
      .int({ error: 'Use um número inteiro de horas' })
      .min(1, { error: 'Inclua de 1 a 200 horas' })
      .max(200, { error: 'Inclua de 1 a 200 horas' }),
    period: packagePeriodSchema,
    status: categoryStatusSchema.optional(),
    visibility: categoryVisibilitySchema.optional(),
  })
  .transform(({ includedHours, ...rest }) => ({ ...rest, includedMinutes: includedHours * 60 }));
export type HourPackageCategoryInput = z.infer<typeof hourPackageCategoryInput>;

/**
 * Fixed schedule: window on the slot grid and at least the default booking length (REC-02).
 * Built from the calendar settings in force (`calendar.slot_minutes`,
 * `calendar.default_booking_minutes`).
 */
export function fixedScheduleCategoryInput(grid: {
  slotMinutes: number;
  minBookingMinutes: number;
}) {
  return z
    .object({
      type: z.literal('fixed_schedule'),
      name: packageNameSchema,
      weekdays: weekdaysSchema,
      startMinute: minuteOfDaySchema,
      endMinute: minuteOfDaySchema,
      pricePerOccurrenceCents: positiveCentsSchema,
      period: packagePeriodSchema,
      status: categoryStatusSchema.optional(),
      visibility: categoryVisibilitySchema.optional(),
    })
    .superRefine((v, ctx) => {
      const gridMessage = `Use horários da grade de ${String(grid.slotMinutes)} minutos`;
      if (v.startMinute % grid.slotMinutes !== 0) {
        ctx.addIssue({ code: 'custom', message: gridMessage, path: ['startMinute'] });
      }
      if (v.endMinute % grid.slotMinutes !== 0) {
        ctx.addIssue({ code: 'custom', message: gridMessage, path: ['endMinute'] });
      }
      if (v.endMinute - v.startMinute < grid.minBookingMinutes) {
        ctx.addIssue({
          code: 'custom',
          message: `O horário precisa ter pelo menos ${String(grid.minBookingMinutes)} minutos`,
          path: ['endMinute'],
        });
      }
    });
}
export type FixedScheduleCategoryInput = z.infer<ReturnType<typeof fixedScheduleCategoryInput>>;

// ---- Tenant subscription requests ----

export const subscriptionQuoteInput = z.object({
  categoryId: idSchema,
  baseOn: localDateSchema,
  roomId: idSchema.optional(),
  couponCode: checkoutCouponCodeSchema.optional(),
  useCredits: z.boolean().optional(),
});
export type SubscriptionQuoteInput = z.infer<typeof subscriptionQuoteInput>;

export const subscriptionPurchaseInput = subscriptionQuoteInput
  .extend({
    paymentMethod: payMethodSchema,
    savedCardId: idSchema.optional(),
    acceptTerms: z.literal(true, { error: 'Aceite os termos da assinatura para continuar' }),
    acceptRecurring: z.literal(true, { error: 'Autorize a cobrança recorrente para continuar' }),
  })
  .refine(savedCardRequired, savedCardRefinement);
export type SubscriptionPurchaseInput = z.infer<typeof subscriptionPurchaseInput>;

export const switchQuoteInput = z.object({
  categoryId: idSchema,
  roomId: idSchema.optional(),
  baseOn: localDateSchema.optional(),
});
export type SwitchQuoteInput = z.infer<typeof switchQuoteInput>;

export const switchInput = switchQuoteInput
  .extend({
    paymentMethod: payMethodSchema,
    savedCardId: idSchema.optional(),
    useCredits: z.boolean().optional(),
  })
  .refine(savedCardRequired, savedCardRefinement);
export type SwitchInput = z.infer<typeof switchInput>;

export const cancelInput = z.object({
  confirm: z.literal(true, { error: 'Confirme o cancelamento' }),
});
export type CancelInput = z.infer<typeof cancelInput>;

/** Admin cancellation requires a justification of 5..500 chars (REC-82). */
export const adminCancelInput = z.object({ justification: justificationSchema });
export type AdminCancelInput = z.infer<typeof adminCancelInput>;

export const payInput = z
  .object({
    paymentMethod: payMethodSchema,
    savedCardId: idSchema.optional(),
    useCredits: z.boolean().optional(),
  })
  .refine(savedCardRequired, savedCardRefinement);
export type PayInput = z.infer<typeof payInput>;

/** Hours bounded by `payment.extra_hours_min` / `payment.extra_hours_max` (REC-64). */
export function extraHoursPurchaseInput(min: number, max: number) {
  const message = `Escolha de ${String(min)} a ${String(max)} horas`;
  return z
    .object({
      hours: z
        .number({ error: message })
        .int({ error: message })
        .min(min, { error: message })
        .max(max, { error: message }),
      useCredits: z.boolean().optional(),
      paymentMethod: payMethodSchema,
      savedCardId: idSchema.optional(),
    })
    .refine(savedCardRequired, savedCardRefinement);
}
export type ExtraHoursPurchaseInput = z.infer<ReturnType<typeof extraHoursPurchaseInput>>;

// ---- Admin requests ----

export const couponTypeSchema = z.enum(['first_booking', 'discount']);
export const discountKindSchema = z.enum(['percent', 'fixed']);
export const couponAppliesToSchema = z.enum(['bookings', 'packages', 'both']);

/**
 * Coupon create/edit (REC-129). `discountValue`: percent in basis points 100..10000 (1%..100%)
 * or fixed cents ≥ 1. `maxUses ≥ uses_count` is checked by the service, which knows the count.
 */
export const couponInput = z
  .object({
    code: couponCodeSchema,
    type: couponTypeSchema,
    discountKind: discountKindSchema,
    discountValue: z
      .number({ error: 'Informe o valor do desconto' })
      .int({ error: 'Informe o valor do desconto' })
      .positive({ error: 'Informe o valor do desconto' }),
    appliesTo: couponAppliesToSchema,
    maxUses: z
      .number()
      .int()
      .min(1, { error: 'O limite de usos precisa ser pelo menos 1' })
      .nullable()
      .default(null),
    perCustomerLimit: z
      .number()
      .int()
      .min(1, { error: 'O limite por cliente precisa ser pelo menos 1' })
      .nullable()
      .default(null),
    validFrom: instantSchema.nullable().default(null),
    validUntil: instantSchema.nullable().default(null),
    enabled: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    if (v.discountKind === 'percent' && (v.discountValue < 100 || v.discountValue > 10_000)) {
      ctx.addIssue({
        code: 'custom',
        message: 'O percentual precisa estar entre 1% e 100%',
        path: ['discountValue'],
      });
    }
    if (v.type === 'first_booking' && v.appliesTo !== 'bookings') {
      ctx.addIssue({
        code: 'custom',
        message: 'Cupom de primeira reserva vale só para reservas',
        path: ['appliesTo'],
      });
    }
    if (v.validFrom !== null && v.validUntil !== null && v.validFrom >= v.validUntil) {
      ctx.addIssue({
        code: 'custom',
        message: 'O fim da validade precisa ser depois do início',
        path: ['validUntil'],
      });
    }
  });
export type CouponInput = z.infer<typeof couponInput>;

export const couponToggleInput = z.object({ enabled: z.boolean() });
export type CouponToggleInput = z.infer<typeof couponToggleInput>;

/** Slot discount (REC-133, REC-134). Alignment, window and "not in the past" need settings and now. */
export const slotDiscountInput = z
  .object({
    roomIds: z
      .array(idSchema)
      .min(1, { error: 'Escolha pelo menos uma sala' })
      .refine((ids) => new Set(ids).size === ids.length, { error: 'Salas repetidas' }),
    date: localDateSchema,
    startMinute: minuteOfDaySchema,
    endMinute: minuteOfDaySchema,
    percent: z
      .number({ error: 'O desconto precisa estar entre 1% e 100%' })
      .int({ error: 'O desconto precisa estar entre 1% e 100%' })
      .min(1, { error: 'O desconto precisa estar entre 1% e 100%' })
      .max(100, { error: 'O desconto precisa estar entre 1% e 100%' }),
  })
  .refine((v) => v.endMinute > v.startMinute, {
    error: 'O fim precisa ser depois do início',
    path: ['endMinute'],
  });
export type SlotDiscountInput = z.infer<typeof slotDiscountInput>;

const ADJUST_MESSAGE = 'Ajuste de 1 a 12.000 minutos, para mais ou para menos';

/** Manual minute adjustment: non-zero integer within ±12000 (REC-43). */
export const balanceAdjustInput = z.object({
  minutes: z
    .number({ error: ADJUST_MESSAGE })
    .int({ error: ADJUST_MESSAGE })
    .min(-12_000, { error: ADJUST_MESSAGE })
    .max(12_000, { error: ADJUST_MESSAGE })
    .refine((m) => m !== 0, { error: ADJUST_MESSAGE }),
  justification: justificationSchema,
});
export type BalanceAdjustInput = z.infer<typeof balanceAdjustInput>;

const CREDIT_MESSAGE = 'Informe um valor entre R$ 0,01 e R$ 100.000,00';

/** Manual credit: 1..10.000.000 cents (REC-112). */
export const manualCreditInput = z.object({
  amountCents: z
    .number({ error: CREDIT_MESSAGE })
    .int({ error: CREDIT_MESSAGE })
    .min(1, { error: CREDIT_MESSAGE })
    .max(10_000_000, { error: CREDIT_MESSAGE }),
  justification: justificationSchema,
});
export type ManualCreditInput = z.infer<typeof manualCreditInput>;

/** Admin sale (REC-150): link hold 1..720 h (service default `payment.pre_reservation_expiry_hours`). */
export const adminSaleInput = z.object({
  userId: idSchema,
  categoryId: idSchema,
  baseOn: localDateSchema,
  roomId: idSchema.optional(),
  couponCode: checkoutCouponCodeSchema.optional(),
  payment: z.discriminatedUnion('mode', [
    z.object({
      mode: z.literal('link'),
      holdHours: z
        .number({ error: 'O prazo do link vai de 1 a 720 horas' })
        .int({ error: 'O prazo do link vai de 1 a 720 horas' })
        .min(1, { error: 'O prazo do link vai de 1 a 720 horas' })
        .max(720, { error: 'O prazo do link vai de 1 a 720 horas' })
        .optional(),
    }),
    z.object({ mode: z.literal('manual'), justification: justificationSchema }),
  ]),
});
export type AdminSaleInput = z.infer<typeof adminSaleInput>;

// ---- Response contracts ----

export const fixedEstimateSchema = z.object({
  minCount: countSchema,
  maxCount: countSchema,
  minCents: centsSchema,
  maxCents: centsSchema,
});

const offerBase = {
  id: idSchema,
  name: z.string().min(1),
  period: packagePeriodSchema,
  periodDays: periodDaysSchema,
  avgHourCents: centsSchema,
};

/** `GET /public/packages` item. */
export const packageOfferSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('hour_package'),
    ...offerBase,
    priceCents: positiveCentsSchema,
    includedMinutes: z.number().int().positive(),
  }),
  z.object({
    type: z.literal('fixed_schedule'),
    ...offerBase,
    pricePerOccurrenceCents: positiveCentsSchema,
    weekdays: weekdaysSchema,
    startMinute: minuteOfDaySchema,
    endMinute: minuteOfDaySchema,
    estimate: fixedEstimateSchema,
  }),
]);
export type PackageOffer = z.infer<typeof packageOfferSchema>;
export const packageOfferListSchema = z.object({ items: z.array(packageOfferSchema) });

export const occurrenceConflictReasonSchema = z.enum([
  'closed',
  'outside_hours',
  'overlaps_booking',
  'in_cleanup',
  'overlaps_block',
  'no_cleanup_before_next',
]);
export const occurrenceSchema = z.object({
  date: localDateSchema,
  startsAt: instantSchema,
  endsAt: instantSchema,
});
export const occurrenceConflictSchema = z.object({
  date: localDateSchema,
  reason: occurrenceConflictReasonSchema,
  label: z.string().min(1),
});
export type OccurrenceConflict = z.infer<typeof occurrenceConflictSchema>;

/** `GET /public/packages/:categoryId/occurrences` (REC-84). */
export const occurrenceCheckSchema = z.object({
  startsOn: localDateSchema,
  endsOn: localDateSchema,
  occurrences: z.array(occurrenceSchema),
  conflicts: z.array(occurrenceConflictSchema),
  periodPriceCents: centsSchema,
  suggestions: z.object({
    rooms: z.array(z.object({ roomId: idSchema, roomName: z.string().min(1) })).max(3),
    baseDates: z.array(localDateSchema).max(3),
  }),
});
export type OccurrenceCheck = z.infer<typeof occurrenceCheckSchema>;

export const couponRejectionReasonSchema = z.enum([
  'not_found',
  'disabled',
  'exhausted',
  'expired',
  'not_yet_valid',
  'first_booking_only',
  'not_applicable',
  'customer_limit',
]);
export type CouponRejectionReason = z.infer<typeof couponRejectionReasonSchema>;
export const couponRejectionSchema = z.object({
  reason: couponRejectionReasonSchema,
  message: z.string().min(1),
});

/** `POST /app/subscriptions/quote` (REC-10). */
export const subscriptionQuoteSchema = z.object({
  startsOn: localDateSchema,
  endsOn: localDateSchema,
  renewsOn: localDateSchema,
  chargeDueOn: localDateSchema,
  priceCents: centsSchema,
  occurrenceCount: countSchema.optional(),
  includedMinutes: z.number().int().positive().optional(),
  vPacCents: centsSchema.optional(),
  discountCents: centsSchema,
  couponRejection: couponRejectionSchema.optional(),
  creditAvailableCents: centsSchema,
  creditAppliedCents: centsSchema,
  payNowCents: centsSchema,
  conflicts: z.array(occurrenceConflictSchema).optional(),
});
export type SubscriptionQuote = z.infer<typeof subscriptionQuoteSchema>;

export const periodSchema = z.object({
  id: idSchema,
  seq: z.number().int().min(1),
  startsOn: localDateSchema,
  endsOn: localDateSchema,
  status: periodStatusSchema,
  priceCents: centsSchema,
  discountCents: centsSchema,
  occurrenceCount: countSchema.optional(),
  minutesBalance: minutesSchema.optional(),
  heldConflicts: z.array(z.object({ date: localDateSchema, label: z.string().min(1) })).optional(),
});
export type Period = z.infer<typeof periodSchema>;

const namedRefSchema = z.object({ id: idSchema, name: z.string().min(1) });

export const subscriptionSchema = z.object({
  id: idSchema,
  status: subscriptionStatusSchema,
  type: packageTypeSchema,
  category: namedRefSchema,
  room: namedRefSchema.optional(),
  baseOn: localDateSchema,
  periodDays: periodDaysSchema,
  currentPeriod: periodSchema.nullable(),
  nextPeriod: periodSchema.nullable(),
  holdExpiresAt: instantSchema.optional(),
  nextCharge: z
    .object({
      on: localDateSchema,
      amountCents: centsSchema,
      method: z.enum(['saved_card', 'pix']),
      cardLast4: z
        .string()
        .regex(/^\d{4}$/)
        .optional(),
    })
    .nullable(),
  balance: z
    .object({
      packageMinutes: minutesSchema,
      includedMinutes: minutesSchema,
      extraMinutes: minutesSchema,
    })
    .optional(),
  occurrences: z
    .object({
      remainingInPeriod: countSchema,
      next: z.object({ startsAt: instantSchema, endsAt: instantSchema }).optional(),
    })
    .optional(),
});
export type Subscription = z.infer<typeof subscriptionSchema>;
export const subscriptionListSchema = z.object({ items: z.array(subscriptionSchema) });

/** 201 of purchase and switch: `charge` null = nothing to pay (coupon/credits cover it). */
export const subscriptionPurchaseResultSchema = z.object({
  subscription: subscriptionSchema,
  charge: chargeIntentSchema.nullable(),
});
export type SubscriptionPurchaseResult = z.infer<typeof subscriptionPurchaseResultSchema>;

/** Package ledger types plus the extra-minute ledger's `grant` (its other types are shared). */
export const ledgerEntryTypeSchema = z.enum([...PACKAGE_LEDGER_ENTRY_TYPES, 'grant']);

/** Extrato line (REC-41): signed minutes, balance after, formula text for debits. */
export const ledgerEntrySchema = z.object({
  id: z.string().min(1),
  at: instantSchema,
  kind: z.enum(['package', 'extra']),
  entryType: ledgerEntryTypeSchema,
  label: z.string().min(1),
  minutes: z.number().int(),
  balanceAfter: minutesSchema,
  bookingCode: bookingCodeSchema.optional(),
  detailText: z.string().min(1).optional(),
  lotExpiresAt: instantSchema.optional(),
});
export type LedgerEntry = z.infer<typeof ledgerEntrySchema>;
export const ledgerPageSchema = z.object({
  items: z.array(ledgerEntrySchema),
  nextCursor: z.string().min(1).nullable(),
});
export type LedgerPage = z.infer<typeof ledgerPageSchema>;

/** `POST /app/subscriptions/:id/switch/quote` (REC-72). */
export const switchQuoteSchema = z.object({
  remainingMinutes: minutesSchema.optional(),
  convertedMinutes: minutesSchema.optional(),
  newIncludedMinutes: minutesSchema.optional(),
  newPeriodTotalMinutes: minutesSchema.optional(),
  releasedOccurrences: countSchema.optional(),
  startsOn: localDateSchema,
  endsOn: localDateSchema,
  priceCents: centsSchema,
  creditAppliedCents: centsSchema,
  payNowCents: centsSchema,
  conflicts: z.array(occurrenceConflictSchema).optional(),
});
export type SwitchQuote = z.infer<typeof switchQuoteSchema>;

/** `GET /app/subscriptions/:id/cancel-preview` (REC-79). */
export const cancelPreviewSchema = z.object({
  minutesLost: minutesSchema.optional(),
  paidUpcomingPeriodLostCents: centsSchema.optional(),
  occurrencesReleased: countSchema.optional(),
  extraMinutesKept: minutesSchema,
});
export type CancelPreview = z.infer<typeof cancelPreviewSchema>;

export const cancelResultSchema = z.object({ subscription: subscriptionSchema });
export const payResultSchema = z.object({
  charge: chargeIntentSchema.nullable(),
  subscription: subscriptionSchema,
});

export const extraLotSchema = z.object({
  id: idSchema,
  source: extraLotSourceSchema,
  minutesGranted: z.number().int().positive(),
  minutesRemaining: minutesSchema,
  expiresAt: instantSchema,
});

/** `GET /app/extra-hours` (REC-62). */
export const extraHoursSummarySchema = z.object({
  eligible: z.boolean(),
  reason: z.string().min(1).optional(),
  unitPriceCents: positiveCentsSchema.optional(),
  minHours: z.number().int().positive(),
  maxHours: z.number().int().positive(),
  lots: z.array(extraLotSchema),
  totalRemainingMinutes: minutesSchema,
});
export type ExtraHoursSummary = z.infer<typeof extraHoursSummarySchema>;

export const extraHoursPurchaseResultSchema = z.object({
  purchase: z.object({
    id: idSchema,
    hours: z.number().int().positive(),
    unitPriceCents: positiveCentsSchema,
    totalCents: positiveCentsSchema,
    status: z.enum(['awaiting_payment', 'paid', 'cancelled']),
  }),
  charge: chargeIntentSchema.nullable(),
});
export type ExtraHoursPurchaseResult = z.infer<typeof extraHoursPurchaseResultSchema>;

/** `GET /app/credits` (REC-114). */
export const creditsSummarySchema = z.object({
  availableCents: centsSchema,
  lots: z.array(
    z.object({
      id: idSchema,
      source: creditSourceSchema,
      label: z.string().min(1),
      amountCents: positiveCentsSchema,
      remainingCents: centsSchema,
      expiresAt: instantSchema,
    }),
  ),
  ledger: z.array(
    z.object({
      at: instantSchema,
      entryType: z.enum(['grant', 'use', 'refund', 'expiry', 'manual_adjustment']),
      label: z.string().min(1),
      amountCents: z.number().int(),
      bookingCode: bookingCodeSchema.optional(),
    }),
  ),
});
export type CreditsSummary = z.infer<typeof creditsSummarySchema>;

/** `GET /app/purchases/history` item (REC-145). */
export const purchaseHistoryItemSchema = z.object({
  chargeId: idSchema,
  at: instantSchema,
  description: z.string().min(1),
  purpose: chargePurposeSchema,
  method: chargeMethodSchema,
  amountCents: positiveCentsSchema,
  refundedCents: centsSchema,
  status: chargeStatusSchema,
  statusLabel: z.string().min(1),
});
export type PurchaseHistoryItem = z.infer<typeof purchaseHistoryItemSchema>;
export const purchaseHistoryPageSchema = z.object({
  items: z.array(purchaseHistoryItemSchema),
  nextCursor: z.string().min(1).nullable(),
});

/** Admin coupon row (REC-128). */
export const couponSchema = z.object({
  id: idSchema,
  code: couponCodeSchema,
  type: couponTypeSchema,
  discountKind: discountKindSchema,
  discountValue: z.number().int().positive(),
  appliesTo: couponAppliesToSchema,
  maxUses: z.number().int().positive().nullable(),
  usesCount: countSchema,
  perCustomerLimit: z.number().int().positive().nullable(),
  validFrom: instantSchema.nullish(),
  validUntil: instantSchema.nullish(),
  enabled: z.boolean(),
});
export type Coupon = z.infer<typeof couponSchema>;
export const couponListSchema = z.object({ items: z.array(couponSchema) });

/** Coupon history line (REC-131). */
export const couponUseSchema = z.object({
  id: idSchema,
  at: instantSchema,
  customerName: z.string().min(1),
  bookingCode: bookingCodeSchema.optional(),
  subscriptionCategory: z.string().min(1).optional(),
  discountCents: centsSchema,
  status: couponUseStatusSchema,
});
export type CouponUse = z.infer<typeof couponUseSchema>;
export const couponUseListSchema = z.object({ items: z.array(couponUseSchema) });

export const slotDiscountSchema = z.object({
  id: idSchema,
  roomId: idSchema,
  startsAt: instantSchema,
  endsAt: instantSchema,
  percent: z.number().int().min(1).max(100),
  consumed: z.boolean(),
});
export type SlotDiscount = z.infer<typeof slotDiscountSchema>;
export const slotDiscountListSchema = z.object({ items: z.array(slotDiscountSchema) });

/** `POST /admin/slot-discounts` (REC-133). */
export const slotDiscountApplyResultSchema = z.object({
  created: z.array(slotDiscountSchema),
  skipped: z.array(
    z.object({
      roomId: idSchema,
      startMinute: minuteOfDaySchema,
      endMinute: minuteOfDaySchema,
      reason: z.literal('occupied'),
    }),
  ),
});
export type SlotDiscountApplyResult = z.infer<typeof slotDiscountApplyResultSchema>;

/** Gestão de Reservas → Assinaturas row (REC-148). */
export const adminSubscriptionRowSchema = z.object({
  id: idSchema,
  customer: namedRefSchema,
  category: namedRefSchema,
  type: packageTypeSchema,
  room: namedRefSchema.optional(),
  baseOn: localDateSchema,
  nextChargeOn: localDateSchema.optional(),
  status: subscriptionStatusSchema,
  statusLabel: z.string().min(1),
  balanceText: z.string(),
});
export type AdminSubscriptionRow = z.infer<typeof adminSubscriptionRowSchema>;
export const adminSubscriptionListSchema = z.object({
  items: z.array(adminSubscriptionRowSchema),
  nextCursor: z.string().min(1).nullable(),
});

export const packageOptionReasonSchema = z.enum([
  'insufficient',
  'outside_period',
  'block_category',
  'suspended',
]);

export const packageOptionSchema = z.object({
  debitMinutes: minutesSchema,
  fromPackageMinutes: minutesSchema,
  fromExtraMinutes: minutesSchema,
  packageAvailableMinutes: minutesSchema,
  extraAvailableMinutes: minutesSchema,
  sufficient: z.boolean(),
  reason: packageOptionReasonSchema.optional(),
  breakdown: z.array(
    z.object({
      startMinute: minuteOfDaySchema,
      endMinute: minuteOfDaySchema,
      minutes: z.number().int().positive(),
      vSlotCentsPerHour: centsSchema,
      extraExact: z.string().min(1),
    }),
  ),
  detailText: z.string().min(1),
});
export type PackageOption = z.infer<typeof packageOptionSchema>;

/**
 * nucleo `Quote.extensions` written by receita's steps (`{ discount, credit, package }`), read by
 * the web as `RevenueQuote` (`package` exposed as `packageOption`).
 */
export const revenueQuoteSchema = z
  .object({
    discount: z.object({
      source: discountSourceSchema,
      discountCents: centsSchema,
      slotDiscountCents: centsSchema,
      couponDiscountCents: centsSchema,
      couponId: idSchema.optional(),
      slotDiscountIds: z.array(idSchema),
      couponRejection: couponRejectionSchema.optional(),
      note: z.string().min(1).optional(),
    }),
    credit: z.object({ availableCents: centsSchema, appliedCents: centsSchema }),
    package: packageOptionSchema.nullable(),
  })
  .transform(({ package: packageOption, ...rest }) => ({ ...rest, packageOption }));
export type RevenueQuote = z.infer<typeof revenueQuoteSchema>;

/** = nucleo `ClosedDayCompensationPort.preview` (REC-97). */
export const compensationPreviewSchema = z.object({
  subscribers: countSchema,
  minutes: minutesSchema,
  creditCents: centsSchema,
  fixedOccurrencesCancelled: countSchema,
});
export type CompensationPreview = z.infer<typeof compensationPreviewSchema>;
