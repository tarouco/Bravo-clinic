import {
  adminSubscriptionListSchema,
  couponListSchema,
  couponUseListSchema,
  creditsSummarySchema,
  extraHoursSummarySchema,
  ledgerPageSchema,
  occurrenceCheckSchema,
  packageOfferListSchema,
  periodSchema,
  purchaseHistoryPageSchema,
  revenueQuoteSchema,
  slotDiscountApplyResultSchema,
  slotDiscountListSchema,
  subscriptionListSchema,
  subscriptionPurchaseResultSchema,
  subscriptionQuoteSchema,
  subscriptionSchema,
  switchQuoteSchema,
  cancelPreviewSchema,
} from '@bravo/core';
import { ID } from '../../test/fixtures/nucleo';
import { parseFixture } from '../../test/fixtures/parse';

// Receita contract fixtures for the web tests (AD-035, Lane B). Every fixture is parsed by its
// core contract schema when this module loads, so a contract change fails the web tests. Values
// follow the spec worked examples: Pacote 20h (R$ 1.600,00, 1200 min, R$ 80,00/h), Meio turno
// (Seg–Sex 07:00–09:30, R$ 280,00 per occurrence) and the Wednesday 19:00–20:00 debit of 78 min.

export const RID = {
  pacote: 'aaaaaaaa-aaaa-4aaa-8aaa-111111111111',
  meioTurno: 'aaaaaaaa-aaaa-4aaa-8aaa-222222222222',
  subActive: 'bbbbbbbb-bbbb-4bbb-8bbb-111111111111',
  subSuspended: 'bbbbbbbb-bbbb-4bbb-8bbb-222222222222',
  subAwaiting: 'bbbbbbbb-bbbb-4bbb-8bbb-333333333333',
  periodActive: 'cccccccc-cccc-4ccc-8ccc-111111111111',
  periodNext: 'cccccccc-cccc-4ccc-8ccc-222222222222',
  periodSuspended: 'cccccccc-cccc-4ccc-8ccc-333333333333',
  periodAwaiting: 'cccccccc-cccc-4ccc-8ccc-444444444444',
  coupon: 'dddddddd-dddd-4ddd-8ddd-111111111111',
  couponFixed: 'dddddddd-dddd-4ddd-8ddd-222222222222',
  couponUse: 'dddddddd-dddd-4ddd-8ddd-333333333333',
  slotDiscount: 'eeeeeeee-eeee-4eee-8eee-111111111111',
  lot: 'ffffffff-ffff-4fff-8fff-111111111111',
  creditLot: 'ffffffff-ffff-4fff-8fff-222222222222',
  purchase: 'ffffffff-ffff-4fff-8fff-333333333333',
  charge: '44444444-4444-4444-8444-555555555555',
  chargeExtra: '44444444-4444-4444-8444-666666666666',
} as const;

// ---- Public offers ----

export const packageOffers = parseFixture(
  packageOfferListSchema,
  {
    items: [
      {
        id: RID.pacote,
        name: 'Pacote 20h',
        type: 'hour_package',
        period: 'monthly',
        periodDays: 30,
        priceCents: 160000,
        includedMinutes: 1200,
        avgHourCents: 8000,
      },
      {
        id: RID.meioTurno,
        name: 'Meio turno',
        type: 'fixed_schedule',
        period: 'monthly',
        periodDays: 30,
        pricePerOccurrenceCents: 28000,
        weekdays: [1, 2, 3, 4, 5],
        startMinute: 420,
        endMinute: 570,
        avgHourCents: 11200,
        estimate: { minCount: 20, maxCount: 22, minCents: 560000, maxCents: 616000 },
      },
    ],
  },
  'packageOffers',
);
export const pacote20h = packageOffers.items[0]!;
export const meioTurno = packageOffers.items[1]!;

/** Meio turno from 2026-11-02: 22 occurrences, none conflicting; one conflict variant below. */
export const occurrenceCheck = parseFixture(
  occurrenceCheckSchema,
  {
    startsOn: '2026-11-02',
    endsOn: '2026-12-02',
    occurrences: [
      {
        date: '2026-11-02',
        startsAt: '2026-11-02T10:00:00.000Z',
        endsAt: '2026-11-02T12:30:00.000Z',
      },
      {
        date: '2026-11-03',
        startsAt: '2026-11-03T10:00:00.000Z',
        endsAt: '2026-11-03T12:30:00.000Z',
      },
    ],
    conflicts: [],
    periodPriceCents: 616000,
    suggestions: { rooms: [], baseDates: [] },
  },
  'occurrenceCheck',
);

export const occurrenceCheckWithConflict = parseFixture(
  occurrenceCheckSchema,
  {
    ...occurrenceCheck,
    conflicts: [{ date: '2026-11-04', reason: 'overlaps_booking', label: 'Já reservado' }],
    suggestions: {
      rooms: [{ roomId: ID.secundaria, roomName: 'Sala Secundária' }],
      baseDates: ['2026-11-09'],
    },
  },
  'occurrenceCheckWithConflict',
);

export const subscriptionQuote = parseFixture(
  subscriptionQuoteSchema,
  {
    startsOn: '2026-11-02',
    endsOn: '2026-12-02',
    renewsOn: '2026-12-02',
    chargeDueOn: '2026-11-30',
    priceCents: 160000,
    includedMinutes: 1200,
    vPacCents: 8000,
    discountCents: 0,
    creditAvailableCents: 5000,
    creditAppliedCents: 0,
    payNowCents: 160000,
  },
  'subscriptionQuote',
);

// ---- Subscriptions ----

const activePeriod = {
  id: RID.periodActive,
  seq: 1,
  startsOn: '2026-11-02',
  endsOn: '2026-12-02',
  status: 'active',
  priceCents: 160000,
  discountCents: 0,
  minutesBalance: 750,
};

export const subscriptionActive = parseFixture(
  subscriptionSchema,
  {
    id: RID.subActive,
    status: 'active',
    type: 'hour_package',
    category: { id: RID.pacote, name: 'Pacote 20h' },
    baseOn: '2026-11-02',
    periodDays: 30,
    currentPeriod: activePeriod,
    nextPeriod: null,
    nextCharge: { on: '2026-11-30', amountCents: 160000, method: 'saved_card', cardLast4: '4242' },
    balance: { packageMinutes: 750, includedMinutes: 1200, extraMinutes: 90 },
  },
  'subscriptionActive',
);

export const subscriptionSuspended = parseFixture(
  subscriptionSchema,
  {
    id: RID.subSuspended,
    status: 'suspended',
    type: 'hour_package',
    category: { id: RID.pacote, name: 'Pacote 20h' },
    baseOn: '2026-10-02',
    periodDays: 30,
    currentPeriod: {
      id: RID.periodSuspended,
      seq: 2,
      startsOn: '2026-11-01',
      endsOn: '2026-12-01',
      status: 'awaiting_payment',
      priceCents: 160000,
      discountCents: 0,
    },
    nextPeriod: null,
    nextCharge: null,
    balance: { packageMinutes: 0, includedMinutes: 1200, extraMinutes: 0 },
  },
  'subscriptionSuspended',
);

export const subscriptionAwaiting = parseFixture(
  subscriptionSchema,
  {
    id: RID.subAwaiting,
    status: 'awaiting_payment',
    type: 'fixed_schedule',
    category: { id: RID.meioTurno, name: 'Meio turno' },
    room: { id: ID.principal, name: 'Sala Principal' },
    baseOn: '2026-11-02',
    periodDays: 30,
    currentPeriod: {
      id: RID.periodAwaiting,
      seq: 1,
      startsOn: '2026-11-02',
      endsOn: '2026-12-02',
      status: 'awaiting_payment',
      priceCents: 616000,
      discountCents: 0,
      occurrenceCount: 22,
    },
    nextPeriod: null,
    holdExpiresAt: '2026-10-20T12:30:00.000Z',
    nextCharge: null,
    occurrences: {
      remainingInPeriod: 22,
      next: { startsAt: '2026-11-02T10:00:00.000Z', endsAt: '2026-11-02T12:30:00.000Z' },
    },
  },
  'subscriptionAwaiting',
);

export const subscriptionList = parseFixture(
  subscriptionListSchema,
  { items: [subscriptionActive, subscriptionSuspended, subscriptionAwaiting] },
  'subscriptionList',
);

export const subscriptionPurchaseResult = parseFixture(
  subscriptionPurchaseResultSchema,
  {
    subscription: subscriptionAwaiting,
    charge: {
      chargeId: RID.charge,
      method: 'pix',
      status: 'pending',
      amountCents: 616000,
      expiresAt: '2026-10-20T12:30:00.000Z',
      pixQrCodeBase64: 'iVBORw0KGgo=',
      pixCopyPaste: '00020126SANDBOX',
      checkoutUrl: null,
    },
  },
  'subscriptionPurchaseResult',
);

/** Ledger: the Wednesday booking debit of 78 min (formula text) and the purchase grant. */
export const ledgerPage = parseFixture(
  ledgerPageSchema,
  {
    items: [
      {
        id: 'package:1',
        at: '2026-11-04T22:00:00.000Z',
        kind: 'package',
        entryType: 'debit',
        label: 'Reserva',
        minutes: -78,
        balanceAfter: 1122,
        bookingCode: 'BRV-7K2Q9X',
        detailText: '60 min + 18 min de excedente = 78 min',
      },
      {
        id: 'package:0',
        at: '2026-11-02T03:00:00.000Z',
        kind: 'package',
        entryType: 'period_grant',
        label: 'Compra',
        minutes: 1200,
        balanceAfter: 1200,
      },
    ],
    nextCursor: null,
  },
  'ledgerPage',
);

export const ledgerPageWithMore = parseFixture(
  ledgerPageSchema,
  { ...ledgerPage, nextCursor: 'cursor-2' },
  'ledgerPageWithMore',
);

export const switchQuote = parseFixture(
  switchQuoteSchema,
  {
    remainingMinutes: 750,
    convertedMinutes: 750,
    newIncludedMinutes: 1800,
    newPeriodTotalMinutes: 2550,
    startsOn: '2026-11-10',
    endsOn: '2026-12-10',
    priceCents: 240000,
    creditAppliedCents: 0,
    payNowCents: 240000,
  },
  'switchQuote',
);

export const cancelPreview = parseFixture(
  cancelPreviewSchema,
  { minutesLost: 750, extraMinutesKept: 90 },
  'cancelPreview',
);

// ---- Extra hours, credits, history ----

export const extraHoursSummary = parseFixture(
  extraHoursSummarySchema,
  {
    eligible: true,
    unitPriceCents: 8000,
    minHours: 1,
    maxHours: 40,
    lots: [
      {
        id: RID.lot,
        source: 'purchase',
        minutesGranted: 120,
        minutesRemaining: 90,
        expiresAt: '2026-12-02T03:00:00.000Z',
      },
    ],
    totalRemainingMinutes: 90,
  },
  'extraHoursSummary',
);

export const creditsSummary = parseFixture(
  creditsSummarySchema,
  {
    availableCents: 5000,
    lots: [
      {
        id: RID.creditLot,
        source: 'reschedule_difference',
        label: 'Diferença de reagendamento',
        amountCents: 5000,
        remainingCents: 5000,
        expiresAt: '2027-04-20T12:00:00.000Z',
      },
    ],
    ledger: [
      {
        at: '2026-10-20T12:00:00.000Z',
        entryType: 'grant',
        label: 'Diferença de reagendamento',
        amountCents: 5000,
        bookingCode: 'BRV-7K2Q9X',
      },
    ],
  },
  'creditsSummary',
);

export const purchaseHistory = parseFixture(
  purchaseHistoryPageSchema,
  {
    items: [
      {
        chargeId: RID.charge,
        at: '2026-11-01T12:00:00.000Z',
        description: 'Pacote 20h — compra',
        purpose: 'subscription_initial',
        method: 'pix',
        amountCents: 160000,
        refundedCents: 0,
        status: 'approved',
        statusLabel: 'Aprovado',
      },
      {
        chargeId: RID.chargeExtra,
        at: '2026-11-10T12:00:00.000Z',
        description: 'Horas extras — 2h',
        purpose: 'extra_hours',
        method: 'saved_card',
        amountCents: 16000,
        refundedCents: 0,
        status: 'approved',
        statusLabel: 'Aprovado',
      },
    ],
    nextCursor: null,
  },
  'purchaseHistory',
);

// ---- Admin ----

export const couponList = parseFixture(
  couponListSchema,
  {
    items: [
      {
        id: RID.coupon,
        code: 'BRAVO10',
        type: 'discount',
        discountKind: 'percent',
        discountValue: 1000,
        appliesTo: 'both',
        maxUses: 100,
        usesCount: 12,
        perCustomerLimit: 1,
        validFrom: '2026-10-01T03:00:00.000Z',
        validUntil: '2026-12-31T03:00:00.000Z',
        enabled: true,
      },
      {
        id: RID.couponFixed,
        code: 'PRIMEIRA20',
        type: 'first_booking',
        discountKind: 'fixed',
        discountValue: 2000,
        appliesTo: 'bookings',
        maxUses: null,
        usesCount: 3,
        perCustomerLimit: null,
        enabled: false,
      },
    ],
  },
  'couponList',
);

export const couponUses = parseFixture(
  couponUseListSchema,
  {
    items: [
      {
        id: RID.couponUse,
        at: '2026-10-25T15:00:00.000Z',
        customerName: 'Ana Souza',
        bookingCode: 'BRV-7K2Q9X',
        discountCents: 2190,
        status: 'consumed',
      },
    ],
  },
  'couponUses',
);

export const slotDiscountList = parseFixture(
  slotDiscountListSchema,
  {
    items: [
      {
        id: RID.slotDiscount,
        roomId: ID.principal,
        startsAt: '2026-10-27T17:00:00.000Z',
        endsAt: '2026-10-27T19:00:00.000Z',
        percent: 10,
        consumed: false,
      },
    ],
  },
  'slotDiscountList',
);

export const slotDiscountApplyResult = parseFixture(
  slotDiscountApplyResultSchema,
  {
    created: slotDiscountList.items,
    skipped: [{ roomId: ID.secundaria, startMinute: 840, endMinute: 960, reason: 'occupied' }],
  },
  'slotDiscountApplyResult',
);

export const adminSubscriptionList = parseFixture(
  adminSubscriptionListSchema,
  {
    items: [
      {
        id: RID.subActive,
        customer: { id: ID.user, name: 'Ana Souza' },
        category: { id: RID.pacote, name: 'Pacote 20h' },
        type: 'hour_package',
        baseOn: '2026-11-02',
        nextChargeOn: '2026-11-30',
        status: 'active',
        statusLabel: 'Ativa',
        balanceText: '12h 30min de 20h',
      },
      {
        id: RID.subAwaiting,
        customer: { id: ID.user, name: 'Ana Souza' },
        category: { id: RID.meioTurno, name: 'Meio turno' },
        type: 'fixed_schedule',
        room: { id: ID.principal, name: 'Sala Principal' },
        baseOn: '2026-11-02',
        status: 'awaiting_payment',
        statusLabel: 'Aguardando pgto',
        balanceText: '22 ocorrências',
      },
    ],
    nextCursor: null,
  },
  'adminSubscriptionList',
);

/** Period returned by an admin balance adjustment. */
export const adjustedPeriod = parseFixture(periodSchema, activePeriod, 'adjustedPeriod');

// ---- Checkout extensions (nucleo `Quote.extensions`, read as `RevenueQuote`) ----

const noPackage = null;

export interface RevenueQuoteOverrides {
  discount?: Record<string, unknown>;
  credit?: Record<string, unknown>;
  package?: Record<string, unknown> | null;
}

/** Wednesday 19:00–20:00 against Pacote 20h: 60 min + 18 min de excedente = 78 min. */
const sufficientPackage = {
  debitMinutes: 78,
  fromPackageMinutes: 78,
  fromExtraMinutes: 0,
  packageAvailableMinutes: 750,
  extraAvailableMinutes: 90,
  sufficient: true,
  breakdown: [
    {
      startMinute: 1140,
      endMinute: 1200,
      minutes: 60,
      vSlotCentsPerHour: 12000,
      extraExact: '69/4',
    },
  ],
  detailText: '60 min + 18 min de excedente = 78 min',
};

/** Same booking when the customer only has 40 min left. */
const insufficientPackage = {
  ...sufficientPackage,
  fromPackageMinutes: 40,
  packageAvailableMinutes: 40,
  extraAvailableMinutes: 0,
  sufficient: false,
  reason: 'insufficient',
};

const baseRevenue = {
  discount: {
    source: 'none',
    discountCents: 0,
    slotDiscountCents: 0,
    couponDiscountCents: 0,
    slotDiscountIds: [],
  },
  credit: { availableCents: 0, appliedCents: 0 },
  package: noPackage,
};

/** `RevenueQuote` as the web reads it; overrides replace whole sections. */
export function buildRevenueQuote(overrides: RevenueQuoteOverrides = {}) {
  return parseFixture(revenueQuoteSchema, { ...baseRevenue, ...overrides }, 'revenueQuote');
}

export const revenueQuoteSufficient = buildRevenueQuote({
  credit: { availableCents: 5000, appliedCents: 0 },
  package: sufficientPackage,
});
export const revenueQuoteInsufficient = buildRevenueQuote({
  credit: { availableCents: 5000, appliedCents: 0 },
  package: insufficientPackage,
});
/** Coupon R$ 20,00 beat the slot discount of R$ 16,00 (REC-121). */
export const revenueQuoteCouponWins = buildRevenueQuote({
  discount: {
    source: 'coupon',
    discountCents: 2000,
    slotDiscountCents: 1600,
    couponDiscountCents: 2000,
    couponId: RID.coupon,
    slotDiscountIds: [],
    note: 'Aplicamos o maior desconto: cupom R$ 20,00 (o desconto do horário era R$ 16,00).',
  },
});
