import { expect, it } from 'vitest';
import type { z } from 'zod';

// Contract fixtures shared by the contract tests. Values follow the spec worked examples
// (PR-3 interval 17:30-20:00 on 2026-10-27, SP-1 split) so they read like real responses.

export type ContractCase = [name: string, schema: z.ZodType, valid: unknown, invalid: unknown];

/** One passing and one failing fixture per contract schema (NUC-04). */
export function describeContracts(cases: ContractCase[]): void {
  it.each(cases)('%s accepts its valid fixture', (_name, schema, valid) => {
    const result = schema.safeParse(valid);
    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
  });
  it.each(cases)('%s rejects a missing or invalid key', (_name, schema, _valid, invalid) => {
    expect(schema.safeParse(invalid).success).toBe(false);
  });
}

export const ID = {
  room: '11111111-1111-4111-8111-111111111111',
  booking: '22222222-2222-4222-8222-222222222222',
  category: '33333333-3333-4333-8333-333333333333',
  charge: '44444444-4444-4444-8444-444444444444',
  user: '55555555-5555-4555-8555-555555555555',
  block: '66666666-6666-4666-8666-666666666666',
  other: '77777777-7777-4777-8777-777777777777',
} as const;

export const businessHours = [
  { dayType: 'mon', isClosed: false, openMinute: 420, closeMinute: 1440 },
  { dayType: 'tue', isClosed: false, openMinute: 420, closeMinute: 1440 },
  { dayType: 'wed', isClosed: false, openMinute: 420, closeMinute: 1440 },
  { dayType: 'thu', isClosed: false, openMinute: 420, closeMinute: 1440 },
  { dayType: 'fri', isClosed: false, openMinute: 420, closeMinute: 1440 },
  { dayType: 'sat', isClosed: false, openMinute: 540, closeMinute: 1440 },
  { dayType: 'sun', isClosed: false, openMinute: 540, closeMinute: 1440 },
  { dayType: 'holiday', isClosed: false, openMinute: 540, closeMinute: 1440 },
];

export const roomSummary = {
  id: ID.room,
  slug: 'principal',
  name: 'Sala Principal',
  description: 'Sala ampla',
  idealFor: ['Médico', 'Estética'],
  equipment: ['Maca'],
  cover: null,
  fromPriceCents: 8000,
};

export const segments = [
  {
    startMinute: 1050,
    endMinute: 1140,
    minutes: 90,
    categoryId: ID.category,
    categoryName: '2 horas ou mais',
    dayType: 'weekday',
    rateCentsPerHour: 8000,
    amountCents: 12000,
  },
  {
    startMinute: 1140,
    endMinute: 1200,
    minutes: 60,
    categoryId: ID.other,
    categoryName: '2 horas ou mais — noite',
    dayType: 'weekday',
    rateCentsPerHour: 9900,
    amountCents: 9900,
  },
];

export const paymentPlan = {
  mode: 'deposit_balance',
  depositCents: 10950,
  balanceCents: 10950,
  payNowCents: 10950,
  creditUsedCents: 0,
  balanceChargeAt: '2026-10-25T20:30:00.000Z',
  balanceDueAt: '2026-10-26T20:30:00.000Z',
};

export const quote = {
  roomId: ID.room,
  roomSlug: 'principal',
  roomName: 'Sala Principal',
  date: '2026-10-27',
  startMinute: 1050,
  endMinute: 1200,
  durationMinutes: 150,
  blockCategoryId: null,
  segments,
  grossCents: 21900,
  discount: { source: 'none', cents: 0, label: null },
  extrasCents: 0,
  netCents: 21900,
  creditAvailableCents: 0,
  payment: paymentPlan,
  policyVersion: 1,
  holdMinutes: 15,
  lines: [
    { kind: 'segment', label: '17:30–19:00 · 2 horas ou mais', amountCents: 12000 },
    { kind: 'total', label: 'Total', amountCents: 21900 },
  ],
  notices: [],
  extensions: {},
};

export const policySections = [
  { title: 'Sinal e saldo', paragraphs: ['Você paga um sinal de 50% do valor.'] },
];

export const policyValues = {
  'payment.active_gateway': 'sandbox',
  'payment.deposit_percent': 50,
  'payment.deposit_refundable': false,
  'payment.balance_charge_hours_before': 48,
  'payment.balance_deadline_hours_before': 24,
  'payment.balance_reminder_hours_before': [48, 36, 26],
  'payment.full_upfront_threshold_hours': 48,
  'payment.checkout_hold_minutes': 15,
  'payment.pre_reservation_expiry_hours': 24,
  'payment.subscription_renewal_days_before': 2,
  'payment.renewal_grace_days': 7,
  'payment.extra_hours_min': 1,
  'payment.extra_hours_max': 20,
  'payment.extra_hours_validity_days': 90,
  'payment.closed_day_compensation_enabled': true,
  'credits.validity_days': 90,
  'policy.reschedule_free_count': 1,
  'policy.reschedule_min_hours_before': 24,
  'policy.reschedule_window_days': 60,
  'policy.cancel_refund_min_hours_before': 24,
  'policy.package_cancel_return_min_hours_before': 24,
  'policy.no_show_after_minutes': 30,
  'policy.clinic_cancel_options': ['refund', 'minutes', 'credit'],
};

export const policySnapshot = { ...policyValues, 'policy.version': 1 };

export const bookingSummary = {
  id: ID.booking,
  code: 'BRV-7K2Q9X',
  kind: 'single',
  roomId: ID.room,
  roomSlug: 'principal',
  roomName: 'Sala Principal',
  startsAt: '2026-10-27T20:30:00.000Z',
  endsAt: '2026-10-27T23:00:00.000Z',
  status: 'confirmed',
  statusLabel: 'Confirmada',
  paymentStatus: { code: 'deposit_paid', label: 'Sinal pago · saldo pendente' },
  totalCents: 21900,
  paidCents: 10950,
  balanceCents: 10950,
  balanceDueAt: '2026-10-26T20:30:00.000Z',
  holdExpiresAt: null,
  group: null,
};

export const bookingDetail = {
  ...bookingSummary,
  segments,
  grossCents: 21900,
  discountCents: 0,
  discountSource: 'none',
  creditAppliedCents: 0,
  depositCents: 10950,
  paymentMode: 'deposit_balance',
  cleanupMinutes: 30,
  rescheduleCount: 0,
  checkedInAt: null,
  source: 'web',
  charges: [
    {
      id: ID.charge,
      purpose: 'booking_deposit',
      method: 'pix',
      amountCents: 10950,
      status: 'approved',
      createdAt: '2026-10-20T12:01:00.000Z',
      approvedAt: '2026-10-20T12:03:00.000Z',
    },
  ],
  refunds: [],
  pendingReschedule: null,
  policy: { version: 1, sections: policySections },
  actions: {
    canPay: false,
    canPayBalance: true,
    canReschedule: true,
    rescheduleBlockedReason: null,
    canCancel: true,
  },
};

export const chargeIntent = {
  chargeId: ID.charge,
  method: 'pix',
  status: 'pending',
  amountCents: 10950,
  expiresAt: '2026-10-20T12:15:00.000Z',
  pixQrCodeBase64: 'iVBORw0KGgo=',
  pixCopyPaste: '00020126SANDBOX',
  checkoutUrl: null,
};

export const affectedBooking = {
  id: ID.booking,
  code: 'BRV-7K2Q9X',
  customerName: 'Camila Souza',
  roomName: 'Sala Principal',
  startsAt: '2026-10-27T12:00:00.000Z',
  endsAt: '2026-10-27T14:00:00.000Z',
  status: 'confirmed',
};

export const holiday = {
  id: ID.other,
  date: '2026-11-02',
  name: 'Finados',
  scope: 'national',
  source: 'seed',
  isClosed: false,
  needsReview: false,
  alert: true,
};

export const closedDay = {
  id: ID.other,
  date: '2026-12-24',
  roomId: null,
  roomName: null,
  reason: 'Recesso',
};

export const block = {
  id: ID.block,
  roomId: ID.room,
  tag: 'Limpeza',
  startsAt: '2026-10-27T18:00:00.000Z',
  endsAt: '2026-10-27T19:00:00.000Z',
  recurrenceId: null,
};

export const blockRecurrence = {
  id: ID.other,
  roomId: ID.room,
  tag: 'Limpeza profunda',
  weekdays: [1],
  startMinute: 420,
  endMinute: 480,
  validFrom: '2026-10-26',
  validUntil: null,
  active: true,
};

export const adminCategory = {
  id: ID.category,
  name: '1 hora',
  type: 'hourly',
  weekdays: [1, 2, 3, 4, 5, 6, 7],
  appliesOnHolidays: true,
  startMinute: 0,
  endMinute: 1140,
  weekdayRateCents: 9700,
  weekendRateCents: 12000,
  minDurationMinutes: 60,
  fixedPriceCents: null,
  pricePerOccurrenceCents: null,
  includedMinutes: null,
  period: 'single',
  isReference: true,
  status: 'active',
  visibility: 'public',
  roomId: null,
  displayOrder: 1,
  version: 1,
  averageHourlyCents: 9700,
  editable: true,
};

export const compensation = {
  subscribers: 0,
  minutes: 0,
  creditCents: 0,
  fixedOccurrencesCancelled: 0,
};

/** Shallow copy of `obj` without `key`. */
export function without(obj: Record<string, unknown>, key: string): Record<string, unknown> {
  const copy = { ...obj };
  delete copy[key];
  return copy;
}
