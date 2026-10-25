import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  adminCancelInput,
  adminSaleInput,
  adminSubscriptionListSchema,
  adminSubscriptionRowSchema,
  balanceAdjustInput,
  baseOnRangeMessage,
  cancelInput,
  cancelPreviewSchema,
  cancelResultSchema,
  compensationPreviewSchema,
  couponInput,
  couponListSchema,
  couponSchema,
  couponToggleInput,
  couponUseListSchema,
  couponUseSchema,
  creditsSummarySchema,
  extraHoursPurchaseInput,
  extraHoursPurchaseResultSchema,
  extraHoursSummarySchema,
  fixedScheduleCategoryInput,
  hourPackageCategoryInput,
  ledgerEntrySchema,
  ledgerPageSchema,
  manualCreditInput,
  occurrenceCheckSchema,
  packageOfferListSchema,
  packageOfferSchema,
  payInput,
  payResultSchema,
  purchaseHistoryItemSchema,
  purchaseHistoryPageSchema,
  revenueQuoteSchema,
  slotDiscountApplyResultSchema,
  slotDiscountInput,
  slotDiscountListSchema,
  slotDiscountSchema,
  subscriptionListSchema,
  subscriptionPurchaseInput,
  subscriptionPurchaseResultSchema,
  subscriptionQuoteInput,
  subscriptionQuoteSchema,
  subscriptionSchema,
  switchInput,
  switchQuoteInput,
  switchQuoteSchema,
} from './revenue-schemas';
import { chargeIntent, describeContracts, ID, without } from '../contracts/fixtures.test-support';

function issues(schema: z.ZodType, value: unknown): { path: string; message: string }[] {
  const result = schema.safeParse(value);
  if (result.success) return [];
  return result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
}

function rejectsAt(schema: z.ZodType, value: unknown, path: string): void {
  expect(issues(schema, value).map((i) => i.path)).toContain(path);
}

// ---- Request schemas ----

describe('hourPackageCategoryInput (REC-01)', () => {
  const valid = {
    type: 'hour_package',
    name: 'Pacote 20h mensal',
    fixedPriceCents: 160000,
    includedHours: 20,
    period: 'monthly',
  };

  it('accepts 20 h and stores includedMinutes = 1200', () => {
    const parsed = hourPackageCategoryInput.parse(valid);
    expect(parsed.includedMinutes).toBe(1200);
    expect(parsed).not.toHaveProperty('includedHours');
    expect(parsed).toMatchObject({ fixedPriceCents: 160000, period: 'monthly' });
  });

  it('accepts the 1 and 200 hour bounds', () => {
    expect(hourPackageCategoryInput.parse({ ...valid, includedHours: 1 }).includedMinutes).toBe(60);
    expect(hourPackageCategoryInput.parse({ ...valid, includedHours: 200 }).includedMinutes).toBe(
      12000,
    );
  });

  it.each([0, 201, 20.5])('rejects includedHours %s', (hours) => {
    rejectsAt(hourPackageCategoryInput, { ...valid, includedHours: hours }, 'includedHours');
  });

  it('rejects fixedPriceCents 0, a 1-char name and a period outside monthly/bimonthly/quarterly', () => {
    rejectsAt(hourPackageCategoryInput, { ...valid, fixedPriceCents: 0 }, 'fixedPriceCents');
    rejectsAt(hourPackageCategoryInput, { ...valid, name: 'P' }, 'name');
    rejectsAt(hourPackageCategoryInput, { ...valid, name: 'x'.repeat(81) }, 'name');
    rejectsAt(hourPackageCategoryInput, { ...valid, period: 'single' }, 'period');
    expect(hourPackageCategoryInput.safeParse({ ...valid, period: 'quarterly' }).success).toBe(
      true,
    );
  });
});

describe('fixedScheduleCategoryInput (REC-02)', () => {
  const schema = fixedScheduleCategoryInput({ slotMinutes: 30, minBookingMinutes: 60 });
  const valid = {
    type: 'fixed_schedule',
    name: 'Meio turno mensal',
    weekdays: [1, 2, 3, 4, 5],
    startMinute: 420,
    endMinute: 570,
    pricePerOccurrenceCents: 28000,
    period: 'monthly',
  };

  it('accepts Mon–Fri 07:00–09:30 at R$ 280,00', () => {
    expect(schema.parse(valid)).toMatchObject({ startMinute: 420, endMinute: 570 });
  });

  it('rejects window minutes off the slot grid', () => {
    expect(issues(schema, { ...valid, startMinute: 425 })).toContainEqual({
      path: 'startMinute',
      message: 'Use horários da grade de 30 minutos',
    });
    rejectsAt(schema, { ...valid, endMinute: 575 }, 'endMinute');
  });

  it('rejects a window shorter than the default booking length and accepts exactly it', () => {
    expect(issues(schema, { ...valid, endMinute: 450 })).toContainEqual({
      path: 'endMinute',
      message: 'O horário precisa ter pelo menos 60 minutos',
    });
    expect(schema.safeParse({ ...valid, endMinute: 480 }).success).toBe(true);
  });

  it('rejects no weekday, price 0 and a single period', () => {
    rejectsAt(schema, { ...valid, weekdays: [] }, 'weekdays');
    rejectsAt(schema, { ...valid, pricePerOccurrenceCents: 0 }, 'pricePerOccurrenceCents');
    rejectsAt(schema, { ...valid, period: 'single' }, 'period');
  });
});

describe('baseOnRangeMessage (REC-11)', () => {
  it('names today and the advance limit in dd/mm/yyyy', () => {
    expect(baseOnRangeMessage('2026-10-25', '2027-01-23')).toBe(
      'Escolha uma data base entre 25/10/2026 e 23/01/2027',
    );
  });
});

describe('subscription requests', () => {
  const quote = { categoryId: ID.category, baseOn: '2026-11-02' };
  const purchase = {
    ...quote,
    paymentMethod: 'pix',
    acceptTerms: true,
    acceptRecurring: true,
  };

  it('subscriptionQuoteInput upper-cases the coupon code "bravo10" → "BRAVO10"', () => {
    expect(subscriptionQuoteInput.parse({ ...quote, couponCode: ' bravo10 ' }).couponCode).toBe(
      'BRAVO10',
    );
  });

  it('subscriptionQuoteInput rejects an invalid base date and category id', () => {
    rejectsAt(subscriptionQuoteInput, { ...quote, baseOn: '2026-02-30' }, 'baseOn');
    rejectsAt(subscriptionQuoteInput, { ...quote, categoryId: 'x' }, 'categoryId');
  });

  it('subscriptionPurchaseInput accepts both consents', () => {
    expect(subscriptionPurchaseInput.safeParse(purchase).success).toBe(true);
  });

  it('subscriptionPurchaseInput rejects acceptTerms: false and acceptRecurring: false', () => {
    rejectsAt(subscriptionPurchaseInput, { ...purchase, acceptTerms: false }, 'acceptTerms');
    rejectsAt(
      subscriptionPurchaseInput,
      { ...purchase, acceptRecurring: false },
      'acceptRecurring',
    );
    rejectsAt(subscriptionPurchaseInput, without(purchase, 'acceptTerms'), 'acceptTerms');
  });

  it('saved_card requires savedCardId on purchase, switch and pay', () => {
    rejectsAt(
      subscriptionPurchaseInput,
      { ...purchase, paymentMethod: 'saved_card' },
      'savedCardId',
    );
    rejectsAt(switchInput, { categoryId: ID.category, paymentMethod: 'saved_card' }, 'savedCardId');
    rejectsAt(payInput, { paymentMethod: 'saved_card' }, 'savedCardId');
    expect(payInput.safeParse({ paymentMethod: 'saved_card', savedCardId: ID.other }).success).toBe(
      true,
    );
  });

  it('switchQuoteInput requires a category id', () => {
    expect(switchQuoteInput.safeParse({ categoryId: ID.category }).success).toBe(true);
    rejectsAt(switchQuoteInput, {}, 'categoryId');
  });

  it('cancelInput requires confirm: true; adminCancelInput requires a 5..500 char justification', () => {
    expect(cancelInput.safeParse({ confirm: true }).success).toBe(true);
    rejectsAt(cancelInput, { confirm: false }, 'confirm');
    rejectsAt(adminCancelInput, { justification: 'abcd' }, 'justification');
    expect(adminCancelInput.safeParse({ justification: 'Pedido do cliente' }).success).toBe(true);
  });
});

describe('extraHoursPurchaseInput (REC-64)', () => {
  const schema = extraHoursPurchaseInput(1, 20);

  it('accepts 1, 5 and 20 hours', () => {
    for (const hours of [1, 5, 20]) {
      expect(schema.safeParse({ hours, paymentMethod: 'pix' }).success).toBe(true);
    }
  });

  it.each([0, 21, 2.5])('rejects %s hours on path hours', (hours) => {
    expect(issues(schema, { hours, paymentMethod: 'pix' })).toContainEqual({
      path: 'hours',
      message: 'Escolha de 1 a 20 horas',
    });
  });
});

describe('couponInput (REC-127, REC-129)', () => {
  const valid = {
    code: 'BRAVO10',
    type: 'discount',
    discountKind: 'percent',
    discountValue: 1000,
    appliesTo: 'both',
  };

  it('normalizes "bravo10" to "BRAVO10" and defaults nullable limits', () => {
    expect(couponInput.parse({ ...valid, code: 'bravo10' })).toMatchObject({
      code: 'BRAVO10',
      maxUses: null,
      perCustomerLimit: null,
      validFrom: null,
      validUntil: null,
      enabled: true,
    });
  });

  it.each(['AB', 'A'.repeat(31), 'BRAVO 10', 'BRAVO!'])('rejects code %s', (code) => {
    rejectsAt(couponInput, { ...valid, code }, 'code');
  });

  it('rejects percent 0% and 101% and accepts 1% and 100%', () => {
    rejectsAt(couponInput, { ...valid, discountValue: 0 }, 'discountValue');
    expect(issues(couponInput, { ...valid, discountValue: 10_100 })).toContainEqual({
      path: 'discountValue',
      message: 'O percentual precisa estar entre 1% e 100%',
    });
    expect(couponInput.safeParse({ ...valid, discountValue: 100 }).success).toBe(true);
    expect(couponInput.safeParse({ ...valid, discountValue: 10_000 }).success).toBe(true);
  });

  it('accepts a fixed R$ 20,00 coupon and rejects fixed 0', () => {
    expect(
      couponInput.safeParse({ ...valid, discountKind: 'fixed', discountValue: 2000 }).success,
    ).toBe(true);
    rejectsAt(couponInput, { ...valid, discountKind: 'fixed', discountValue: 0 }, 'discountValue');
  });

  it('requires appliesTo bookings for first_booking coupons', () => {
    rejectsAt(couponInput, { ...valid, type: 'first_booking', appliesTo: 'packages' }, 'appliesTo');
    expect(
      couponInput.safeParse({ ...valid, type: 'first_booking', appliesTo: 'bookings' }).success,
    ).toBe(true);
  });

  it('rejects maxUses 0 and perCustomerLimit 0', () => {
    rejectsAt(couponInput, { ...valid, maxUses: 0 }, 'maxUses');
    rejectsAt(couponInput, { ...valid, perCustomerLimit: 0 }, 'perCustomerLimit');
    expect(couponInput.safeParse({ ...valid, maxUses: 10, perCustomerLimit: 1 }).success).toBe(
      true,
    );
  });

  it('requires validFrom < validUntil when both are set', () => {
    const at = '2026-11-01T03:00:00.000Z';
    rejectsAt(couponInput, { ...valid, validFrom: at, validUntil: at }, 'validUntil');
    expect(
      couponInput.safeParse({ ...valid, validFrom: at, validUntil: '2026-12-01T03:00:00.000Z' })
        .success,
    ).toBe(true);
  });

  it('couponToggleInput takes a boolean', () => {
    expect(couponToggleInput.safeParse({ enabled: false }).success).toBe(true);
    rejectsAt(couponToggleInput, { enabled: 'no' }, 'enabled');
  });
});

describe('slotDiscountInput (REC-134)', () => {
  const valid = {
    roomIds: [ID.room, ID.other],
    date: '2026-10-27',
    startMinute: 1140,
    endMinute: 1320,
    percent: 15,
  };

  it('accepts 15% on two rooms Tue 19:00–22:00', () => {
    expect(slotDiscountInput.parse(valid)).toMatchObject({ startMinute: 1140, endMinute: 1320 });
  });

  it.each([0, 101])('rejects percent %s', (percent) => {
    rejectsAt(slotDiscountInput, { ...valid, percent }, 'percent');
  });

  it('rejects end ≤ start, no room and repeated rooms', () => {
    rejectsAt(slotDiscountInput, { ...valid, endMinute: 1140 }, 'endMinute');
    rejectsAt(slotDiscountInput, { ...valid, roomIds: [] }, 'roomIds');
    rejectsAt(slotDiscountInput, { ...valid, roomIds: [ID.room, ID.room] }, 'roomIds');
  });
});

describe('balanceAdjustInput (REC-43, REC-44)', () => {
  it('accepts +30 and −30 minutes with a justification', () => {
    expect(balanceAdjustInput.safeParse({ minutes: 30, justification: 'Cortesia' }).success).toBe(
      true,
    );
    expect(balanceAdjustInput.safeParse({ minutes: -30, justification: 'Correção' }).success).toBe(
      true,
    );
  });

  it.each([0, 12_001, -12_001, 1.5])('rejects %s minutes', (minutes) => {
    rejectsAt(balanceAdjustInput, { minutes, justification: 'Cortesia' }, 'minutes');
  });

  it('rejects a 4-char justification and a missing one', () => {
    expect(issues(balanceAdjustInput, { minutes: 30, justification: 'abcd' })).toContainEqual({
      path: 'justification',
      message: 'A justificativa precisa ter pelo menos 5 caracteres',
    });
    rejectsAt(balanceAdjustInput, { minutes: 30 }, 'justification');
  });
});

describe('manualCreditInput (REC-112)', () => {
  it('accepts 1 and 10.000.000 cents', () => {
    for (const amountCents of [1, 10_000_000]) {
      expect(manualCreditInput.safeParse({ amountCents, justification: 'Cortesia' }).success).toBe(
        true,
      );
    }
  });

  it.each([0, 10_000_001])('rejects %s cents', (amountCents) => {
    rejectsAt(manualCreditInput, { amountCents, justification: 'Cortesia' }, 'amountCents');
  });

  it('rejects a 4-char justification', () => {
    rejectsAt(manualCreditInput, { amountCents: 5000, justification: 'abcd' }, 'justification');
  });
});

describe('adminSaleInput (REC-150)', () => {
  const base = { userId: ID.user, categoryId: ID.category, baseOn: '2026-11-02' };

  it('accepts a 24 h link and a justified manual sale', () => {
    expect(
      adminSaleInput.parse({ ...base, payment: { mode: 'link', holdHours: 24 } }).payment,
    ).toEqual({ mode: 'link', holdHours: 24 });
    expect(
      adminSaleInput.safeParse({
        ...base,
        payment: { mode: 'manual', justification: 'Pago no balcão' },
      }).success,
    ).toBe(true);
  });

  it.each([0, 721])('rejects a link hold of %s hours', (holdHours) => {
    rejectsAt(
      adminSaleInput,
      { ...base, payment: { mode: 'link', holdHours } },
      'payment.holdHours',
    );
  });

  it('rejects a manual sale with a 4-char justification', () => {
    rejectsAt(
      adminSaleInput,
      { ...base, payment: { mode: 'manual', justification: 'abcd' } },
      'payment.justification',
    );
  });
});

// ---- Response contracts (design.md "API Contracts") ----

const instant = '2026-11-04T22:00:00.000Z';

const hourOffer = {
  id: ID.category,
  name: 'Pacote 20h mensal',
  type: 'hour_package',
  period: 'monthly',
  periodDays: 30,
  priceCents: 160000,
  includedMinutes: 1200,
  avgHourCents: 8000,
};
const fixedOffer = {
  id: ID.other,
  name: 'Meio turno mensal',
  type: 'fixed_schedule',
  period: 'monthly',
  periodDays: 30,
  avgHourCents: 11200,
  pricePerOccurrenceCents: 28000,
  weekdays: [1, 2, 3, 4, 5],
  startMinute: 420,
  endMinute: 570,
  estimate: { minCount: 20, maxCount: 22, minCents: 560000, maxCents: 616000 },
};
const occurrenceCheck = {
  startsOn: '2026-11-02',
  endsOn: '2026-12-02',
  occurrences: [
    {
      date: '2026-11-02',
      startsAt: '2026-11-02T10:00:00.000Z',
      endsAt: '2026-11-02T12:30:00.000Z',
    },
  ],
  conflicts: [{ date: '2026-11-20', reason: 'closed', label: 'Dia fechado' }],
  periodPriceCents: 616000,
  suggestions: {
    rooms: [{ roomId: ID.room, roomName: 'Sala Secundária' }],
    baseDates: ['2026-11-09'],
  },
};
const subscriptionQuote = {
  startsOn: '2026-11-02',
  endsOn: '2026-12-02',
  renewsOn: '2026-12-02',
  chargeDueOn: '2026-11-30',
  priceCents: 160000,
  includedMinutes: 1200,
  vPacCents: 8000,
  discountCents: 0,
  creditAvailableCents: 0,
  creditAppliedCents: 0,
  payNowCents: 160000,
};
const period = {
  id: ID.other,
  seq: 1,
  startsOn: '2026-11-02',
  endsOn: '2026-12-02',
  status: 'active',
  priceCents: 160000,
  discountCents: 0,
  minutesBalance: 750,
};
const subscription = {
  id: ID.booking,
  status: 'active',
  type: 'hour_package',
  category: { id: ID.category, name: 'Pacote 20h mensal' },
  baseOn: '2026-11-02',
  periodDays: 30,
  currentPeriod: period,
  nextPeriod: null,
  nextCharge: { on: '2026-11-30', amountCents: 160000, method: 'saved_card', cardLast4: '4242' },
  balance: { packageMinutes: 750, includedMinutes: 1200, extraMinutes: 300 },
};
const fixedSubscription = {
  ...subscription,
  type: 'fixed_schedule',
  status: 'awaiting_payment',
  room: { id: ID.room, name: 'Sala Principal' },
  holdExpiresAt: instant,
  currentPeriod: {
    ...period,
    status: 'awaiting_payment',
    occurrenceCount: 22,
    minutesBalance: undefined,
  },
  nextCharge: null,
  balance: undefined,
  occurrences: {
    remainingInPeriod: 22,
    next: { startsAt: '2026-11-02T10:00:00.000Z', endsAt: '2026-11-02T12:30:00.000Z' },
  },
};
const ledgerEntry = {
  id: '42',
  at: instant,
  kind: 'package',
  entryType: 'debit',
  label: 'Reserva',
  minutes: -78,
  balanceAfter: 1122,
  bookingCode: 'BRV-7K2Q9X',
  detailText: '60 min + 18 min de excedente = 78 min',
};
const switchQuote = {
  remainingMinutes: 360,
  convertedMinutes: 384,
  newIncludedMinutes: 1800,
  newPeriodTotalMinutes: 2184,
  startsOn: '2026-11-10',
  endsOn: '2026-12-10',
  priceCents: 225000,
  creditAppliedCents: 0,
  payNowCents: 225000,
};
const extraHoursSummary = {
  eligible: true,
  unitPriceCents: 8000,
  minHours: 1,
  maxHours: 20,
  lots: [
    {
      id: ID.other,
      source: 'purchase',
      minutesGranted: 300,
      minutesRemaining: 300,
      expiresAt: '2027-02-08T15:00:00.000Z',
    },
  ],
  totalRemainingMinutes: 300,
};
const extraHoursPurchase = {
  purchase: {
    id: ID.other,
    hours: 5,
    unitPriceCents: 8000,
    totalCents: 40000,
    status: 'awaiting_payment',
  },
  charge: chargeIntent,
};
const creditsSummary = {
  availableCents: 20533,
  lots: [
    {
      id: ID.other,
      source: 'closed_day_compensation',
      label: 'Compensação de dia fechado',
      amountCents: 20533,
      remainingCents: 20533,
      expiresAt: '2027-02-18T15:00:00.000Z',
    },
  ],
  ledger: [
    { at: instant, entryType: 'grant', label: 'Compensação de dia fechado', amountCents: 20533 },
    { at: instant, entryType: 'use', label: 'Uso', amountCents: -5000, bookingCode: 'BRV-7K2Q9X' },
  ],
};
const historyItem = {
  chargeId: ID.charge,
  at: instant,
  description: 'Pacote 20h mensal · Renovação',
  purpose: 'subscription_renewal',
  method: 'pix',
  amountCents: 160000,
  refundedCents: 0,
  status: 'approved',
  statusLabel: 'Aprovado',
};
const coupon = {
  id: ID.other,
  code: 'BRAVO10',
  type: 'discount',
  discountKind: 'percent',
  discountValue: 1000,
  appliesTo: 'both',
  maxUses: null,
  usesCount: 3,
  perCustomerLimit: null,
  enabled: true,
};
const firstBookingCoupon = {
  ...coupon,
  code: 'PRIMEIRA20',
  type: 'first_booking',
  discountKind: 'fixed',
  discountValue: 2000,
  appliesTo: 'bookings',
  maxUses: 10,
  usesCount: 1,
  validFrom: '2026-11-01T03:00:00.000Z',
  validUntil: '2026-12-01T03:00:00.000Z',
};
const couponUse = {
  id: ID.other,
  at: instant,
  customerName: 'Camila Souza',
  bookingCode: 'BRV-7K2Q9X',
  discountCents: 2000,
  status: 'reserved',
};
const slotDiscount = {
  id: ID.other,
  roomId: ID.room,
  startsAt: '2026-10-27T22:00:00.000Z',
  endsAt: '2026-10-28T01:00:00.000Z',
  percent: 15,
  consumed: false,
};
const slotDiscountResult = {
  created: [slotDiscount],
  skipped: [{ roomId: ID.room, startMinute: 1200, endMinute: 1290, reason: 'occupied' }],
};
const adminRow = {
  id: ID.booking,
  customer: { id: ID.user, name: 'Camila Souza' },
  category: { id: ID.category, name: 'Pacote 20h mensal' },
  type: 'hour_package',
  baseOn: '2026-11-02',
  nextChargeOn: '2026-11-30',
  status: 'active',
  statusLabel: 'Ativa',
  balanceText: '12h 30min',
};
const packageExtension = {
  debitMinutes: 78,
  fromPackageMinutes: 78,
  fromExtraMinutes: 0,
  packageAvailableMinutes: 1200,
  extraAvailableMinutes: 0,
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
const extensions = {
  discount: {
    source: 'coupon',
    discountCents: 2000,
    slotDiscountCents: 1600,
    couponDiscountCents: 2000,
    couponId: ID.other,
    slotDiscountIds: [ID.block],
    note: 'Aplicamos o maior desconto: cupom R$ 20,00 (o desconto do horário era R$ 16,00).',
  },
  credit: { availableCents: 5000, appliedCents: 0 },
  package: packageExtension,
};
const compensationPreview = {
  subscribers: 2,
  minutes: 40,
  creditCents: 20533,
  fixedOccurrencesCancelled: 1,
};

describe('revenue response contracts', () => {
  describeContracts([
    [
      'packageOfferSchema (hour package)',
      packageOfferSchema,
      hourOffer,
      without(hourOffer, 'includedMinutes'),
    ],
    [
      'packageOfferSchema (fixed schedule)',
      packageOfferSchema,
      fixedOffer,
      without(fixedOffer, 'estimate'),
    ],
    [
      'packageOfferListSchema',
      packageOfferListSchema,
      { items: [hourOffer, fixedOffer] },
      { items: [{ ...hourOffer, periodDays: 31 }] },
    ],
    [
      'occurrenceCheckSchema',
      occurrenceCheckSchema,
      occurrenceCheck,
      without(occurrenceCheck, 'periodPriceCents'),
    ],
    [
      'subscriptionQuoteSchema',
      subscriptionQuoteSchema,
      subscriptionQuote,
      without(subscriptionQuote, 'payNowCents'),
    ],
    [
      'subscriptionSchema (hour package)',
      subscriptionSchema,
      subscription,
      { ...subscription, status: 'paused' },
    ],
    [
      'subscriptionSchema (fixed schedule)',
      subscriptionSchema,
      fixedSubscription,
      without(fixedSubscription, 'currentPeriod'),
    ],
    [
      'subscriptionListSchema',
      subscriptionListSchema,
      { items: [subscription] },
      { items: [without(subscription, 'baseOn')] },
    ],
    [
      'subscriptionPurchaseResultSchema',
      subscriptionPurchaseResultSchema,
      { subscription: fixedSubscription, charge: { ...chargeIntent, amountCents: 616000 } },
      { subscription },
    ],
    ['ledgerEntrySchema', ledgerEntrySchema, ledgerEntry, { ...ledgerEntry, kind: 'credit' }],
    [
      'ledgerPageSchema',
      ledgerPageSchema,
      { items: [ledgerEntry], nextCursor: null },
      { items: [ledgerEntry] },
    ],
    ['switchQuoteSchema', switchQuoteSchema, switchQuote, without(switchQuote, 'startsOn')],
    [
      'cancelPreviewSchema',
      cancelPreviewSchema,
      { minutesLost: 360, extraMinutesKept: 300 },
      { minutesLost: 360 },
    ],
    ['cancelResultSchema', cancelResultSchema, { subscription }, {}],
    ['payResultSchema', payResultSchema, { charge: null, subscription }, { charge: null }],
    [
      'extraHoursSummarySchema',
      extraHoursSummarySchema,
      extraHoursSummary,
      without(extraHoursSummary, 'totalRemainingMinutes'),
    ],
    [
      'extraHoursPurchaseResultSchema',
      extraHoursPurchaseResultSchema,
      extraHoursPurchase,
      { ...extraHoursPurchase, purchase: { ...extraHoursPurchase.purchase, status: 'pending' } },
    ],
    [
      'creditsSummarySchema',
      creditsSummarySchema,
      creditsSummary,
      without(creditsSummary, 'availableCents'),
    ],
    [
      'purchaseHistoryItemSchema',
      purchaseHistoryItemSchema,
      historyItem,
      without(historyItem, 'statusLabel'),
    ],
    [
      'purchaseHistoryPageSchema',
      purchaseHistoryPageSchema,
      {
        items: [historyItem, { ...historyItem, status: 'partially_refunded', refundedCents: 8000 }],
        nextCursor: 'abc',
      },
      { items: [historyItem], nextCursor: '' },
    ],
    ['couponSchema', couponSchema, coupon, without(coupon, 'usesCount')],
    [
      'couponSchema (first booking)',
      couponSchema,
      firstBookingCoupon,
      { ...firstBookingCoupon, code: 'AB' },
    ],
    ['couponListSchema', couponListSchema, { items: [coupon, firstBookingCoupon] }, { items: {} }],
    ['couponUseSchema', couponUseSchema, couponUse, { ...couponUse, status: 'used' }],
    ['couponUseListSchema', couponUseListSchema, { items: [couponUse] }, {}],
    ['slotDiscountSchema', slotDiscountSchema, slotDiscount, { ...slotDiscount, percent: 0 }],
    ['slotDiscountListSchema', slotDiscountListSchema, { items: [slotDiscount] }, {}],
    [
      'slotDiscountApplyResultSchema',
      slotDiscountApplyResultSchema,
      slotDiscountResult,
      { ...slotDiscountResult, skipped: [{ ...slotDiscountResult.skipped[0], reason: 'blocked' }] },
    ],
    [
      'adminSubscriptionRowSchema',
      adminSubscriptionRowSchema,
      adminRow,
      without(adminRow, 'statusLabel'),
    ],
    [
      'adminSubscriptionListSchema',
      adminSubscriptionListSchema,
      { items: [adminRow], nextCursor: null },
      { items: [adminRow] },
    ],
    ['revenueQuoteSchema', revenueQuoteSchema, extensions, without(extensions, 'credit')],
    [
      'compensationPreviewSchema',
      compensationPreviewSchema,
      compensationPreview,
      without(compensationPreview, 'fixedOccurrencesCancelled'),
    ],
  ]);

  it('revenueQuoteSchema exposes extensions.package as packageOption', () => {
    const parsed = revenueQuoteSchema.parse(extensions);
    expect(parsed.packageOption?.debitMinutes).toBe(78);
    expect(parsed.packageOption?.detailText).toBe('60 min + 18 min de excedente = 78 min');
    expect(parsed).not.toHaveProperty('package');
    expect(parsed.discount.source).toBe('coupon');
  });

  it('revenueQuoteSchema accepts package: null and an insufficient option with its reason', () => {
    expect(revenueQuoteSchema.parse({ ...extensions, package: null }).packageOption).toBeNull();
    const insufficient = {
      ...packageExtension,
      fromPackageMinutes: 0,
      packageAvailableMinutes: 40,
      sufficient: false,
      reason: 'insufficient',
    };
    expect(
      revenueQuoteSchema.parse({ ...extensions, package: insufficient }).packageOption,
    ).toMatchObject({ sufficient: false, reason: 'insufficient', debitMinutes: 78 });
    expect(
      revenueQuoteSchema.safeParse({ ...extensions, package: { ...insufficient, reason: 'other' } })
        .success,
    ).toBe(false);
  });
});
