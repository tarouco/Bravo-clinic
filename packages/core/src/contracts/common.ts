import { z } from 'zod';
import type { LocalDate } from '../time';
import { settingsCatalog, type SettingKey, type SettingValue } from '../settings/catalog';
import { bookingStatusSchema, paymentModeSchema, paymentStatusCodeSchema } from '../status/booking';

// Shared shapes of design.md section "API Contract" (AD-035). JSON is camelCase, money is integer
// cents, instants are ISO-8601 UTC strings, local dates are YYYY-MM-DD, minutes are minutes of day.

/** Every catalog key with its typed value. */
export type SettingsValues = { [K in SettingKey]: SettingValue<K> };

export const idSchema = z.uuid({ error: 'Identificador inválido' });
export const localDateSchema = z.iso
  .date({ error: 'Data inválida' })
  .transform((v) => v as LocalDate);
export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, { error: 'Mês inválido' });
export const instantSchema = z.iso.datetime({ error: 'Data e hora inválidas' });
export const minuteOfDaySchema = z
  .number({ error: 'Horário inválido' })
  .int({ error: 'Horário inválido' })
  .min(0, { error: 'Horário inválido' })
  .max(1440, { error: 'Horário inválido' });
export const centsSchema = z.number().int().nonnegative();
export const positiveCentsSchema = z
  .number()
  .int()
  .positive({ error: 'Informe um valor maior que zero' });
export const weekdaysSchema = z
  .array(z.number().int().min(1).max(7))
  .min(1, { error: 'Escolha pelo menos um dia da semana' })
  .refine((days) => new Set(days).size === days.length, { error: 'Dias repetidos' });
export const roomSlugSchema = z.string().regex(/^[a-z0-9-]{1,60}$/, { error: 'Sala inválida' });
export const bookingCodeSchema = z.string().regex(/^BRV-[0-9A-Z]{6}$/);
export const justificationSchema = z
  .string({ error: 'Informe a justificativa' })
  .trim()
  .min(5, { error: 'A justificativa precisa ter pelo menos 5 caracteres' })
  .max(500, { error: 'Use no máximo 500 caracteres' });
export const dayTypeSchema = z.enum(['weekday', 'weekend_holiday']);
export const discountSourceSchema = z.enum(['none', 'coupon', 'slot_discount']);
export const bookingSourceSchema = z.enum(['web', 'app', 'admin', 'mcp']);
export const bookingKindSchema = z.enum(['single', 'fixed_occurrence']);
export const chargeStatusSchema = z.enum([
  'pending',
  'approved',
  'rejected',
  'cancelled',
  'expired',
  'refunded',
  'partially_refunded',
  'charged_back',
]);
export const chargePurposeSchema = z.enum([
  'booking_deposit',
  'booking_balance',
  'booking_full',
  'booking_difference',
  'subscription_initial',
  'subscription_renewal',
  'extra_hours',
  'extra_service',
]);
export const chargeMethodSchema = z.enum(['pix', 'card', 'saved_card', 'credit']);
export const payMethodSchema = z.enum(['pix', 'card', 'saved_card']);
export const holidayScopeSchema = z.enum(['national', 'state', 'municipal', 'optional']);
export const holidaySourceSchema = z.enum(['seed', 'brasilapi', 'manual']);

/** Reasons a candidate interval is rejected (docs/architecture.md section 7.4). */
export const REJECT_REASONS = [
  'closed',
  'outside_hours',
  'misaligned',
  'too_short',
  'in_past',
  'too_far',
  'overlaps_booking',
  'in_cleanup',
  'overlaps_block',
  'no_cleanup_before_next',
] as const;
export const rejectReasonSchema = z.enum(REJECT_REASONS);

export const windowSchema = z
  .object({ openMinute: minuteOfDaySchema, closeMinute: minuteOfDaySchema })
  .refine((w) => w.closeMinute > w.openMinute, {
    error: 'O fim precisa ser depois do início',
    path: ['closeMinute'],
  });

export const businessHoursRowSchema = z
  .object({
    dayType: z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun', 'holiday']),
    isClosed: z.boolean(),
    openMinute: minuteOfDaySchema.max(1439, { error: 'Horário inválido' }),
    closeMinute: minuteOfDaySchema.min(1, { error: 'Horário inválido' }),
  })
  .refine((r) => r.closeMinute > r.openMinute, {
    error: 'O fechamento precisa ser depois da abertura',
    path: ['closeMinute'],
  });

export const photoSchema = z.object({
  url: z.string().min(1),
  alt: z.string(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
});

export const roomSummarySchema = z.object({
  id: idSchema,
  slug: roomSlugSchema,
  name: z.string().min(1),
  description: z.string(),
  idealFor: z.array(z.string()),
  equipment: z.array(z.string()),
  cover: photoSchema.nullable(),
  fromPriceCents: centsSchema.nullable(),
});
export type RoomSummary = z.infer<typeof roomSummarySchema>;

/** Public grid cell: never carries admin states, names, tags or cleanup periods (NUC-77). */
export const publicCellSchema = z.strictObject({
  startMinute: minuteOfDaySchema,
  available: z.boolean(),
  maxEndMinute: minuteOfDaySchema.nullable(),
  discountPercent: z.number().int().min(1).max(100).optional(),
});
export type PublicCell = z.infer<typeof publicCellSchema>;

export const adminCellStateSchema = z.enum([
  'free',
  'booking',
  'cleanup',
  'block',
  'leftover',
  'closed',
  'past',
]);
export const adminCellSchema = publicCellSchema.extend({ adminState: adminCellStateSchema });
export type AdminCell = z.infer<typeof adminCellSchema>;

export const quoteSegmentSchema = z.object({
  startMinute: minuteOfDaySchema,
  endMinute: minuteOfDaySchema,
  minutes: z.number().int().positive(),
  categoryId: idSchema.nullable(),
  categoryName: z.string().min(1),
  dayType: dayTypeSchema,
  rateCentsPerHour: centsSchema.nullable(),
  amountCents: centsSchema,
});
export type QuoteSegment = z.infer<typeof quoteSegmentSchema>;

export const quoteLineSchema = z.object({
  kind: z.enum([
    'segment',
    'discount',
    'extra',
    'credit',
    'total',
    'deposit',
    'balance',
    'package',
  ]),
  label: z.string().min(1),
  amountCents: z.number().int().nullable(),
  detail: z.string().optional(),
});
export type QuoteLine = z.infer<typeof quoteLineSchema>;

export const paymentPlanSchema = z.object({
  mode: paymentModeSchema,
  depositCents: centsSchema,
  balanceCents: centsSchema,
  payNowCents: centsSchema,
  creditUsedCents: centsSchema,
  balanceChargeAt: instantSchema.nullable(),
  balanceDueAt: instantSchema.nullable(),
});
export type PaymentPlan = z.infer<typeof paymentPlanSchema>;

export const quoteSchema = z.object({
  roomId: idSchema,
  roomSlug: roomSlugSchema,
  roomName: z.string().min(1),
  date: localDateSchema,
  startMinute: minuteOfDaySchema,
  endMinute: minuteOfDaySchema,
  durationMinutes: z.number().int().positive(),
  blockCategoryId: idSchema.nullable(),
  segments: z.array(quoteSegmentSchema).min(1),
  grossCents: centsSchema,
  discount: z.object({
    source: discountSourceSchema,
    cents: centsSchema,
    label: z.string().nullable(),
  }),
  extrasCents: centsSchema,
  netCents: centsSchema,
  creditAvailableCents: centsSchema,
  payment: paymentPlanSchema,
  policyVersion: z.number().int().min(1),
  holdMinutes: z.number().int().positive(),
  lines: z.array(quoteLineSchema),
  notices: z.array(z.string()),
  extensions: z.record(z.string(), z.unknown()),
});
export type Quote = z.infer<typeof quoteSchema>;

export const policySectionSchema = z.object({
  title: z.string().min(1),
  paragraphs: z.array(z.string().min(1)).min(1),
});
export type PolicySection = z.infer<typeof policySectionSchema>;

/** Catalog keys frozen in `bookings.policy_snapshot` (NUC-31). */
export const POLICY_SNAPSHOT_KEYS = (Object.keys(settingsCatalog) as SettingKey[]).filter(
  (key) =>
    key.startsWith('payment.') || key.startsWith('policy.') || key === 'credits.validity_days',
);

type PolicySnapshotKey =
  Extract<SettingKey, `payment.${string}` | `policy.${string}`> | 'credits.validity_days';
type PolicyValueKey = Exclude<PolicySnapshotKey, 'policy.version'>;

/** Every `payment.*`, `policy.*` and `credits.validity_days` value, keyed by catalog key. */
export type PolicySnapshot = { [K in PolicySnapshotKey]: SettingValue<K> };
/** The editable part of the snapshot: everything except the system-managed `policy.version`. */
export type PolicyValues = { [K in PolicyValueKey]: SettingValue<K> };

function catalogShape<K extends SettingKey>(keys: readonly K[]) {
  const shape: Record<string, z.ZodType> = {};
  for (const key of keys) shape[key] = settingsCatalog[key].schema;
  return shape as { [P in K]: (typeof settingsCatalog)[P]['schema'] };
}

export const policySnapshotSchema = z.strictObject(
  catalogShape(POLICY_SNAPSHOT_KEYS as PolicySnapshotKey[]),
);

export const policyValuesSchema = z.strictObject(
  catalogShape(POLICY_SNAPSHOT_KEYS.filter((k) => k !== 'policy.version') as PolicyValueKey[]),
);

export const bookingSummarySchema = z.object({
  id: idSchema,
  code: bookingCodeSchema,
  kind: bookingKindSchema,
  roomId: idSchema,
  roomSlug: roomSlugSchema,
  roomName: z.string().min(1),
  startsAt: instantSchema,
  endsAt: instantSchema,
  status: bookingStatusSchema,
  statusLabel: z.string().min(1),
  paymentStatus: z.object({ code: paymentStatusCodeSchema, label: z.string().min(1) }),
  totalCents: centsSchema,
  paidCents: centsSchema,
  balanceCents: centsSchema,
  balanceDueAt: instantSchema.nullable(),
  holdExpiresAt: instantSchema.nullable(),
  group: z.object({ id: z.string().min(1), label: z.string().min(1) }).nullable(),
});
export type BookingSummary = z.infer<typeof bookingSummarySchema>;

export const bookingDetailSchema = bookingSummarySchema.extend({
  segments: z.array(quoteSegmentSchema),
  grossCents: centsSchema,
  discountCents: centsSchema,
  discountSource: discountSourceSchema,
  creditAppliedCents: centsSchema,
  depositCents: centsSchema,
  paymentMode: paymentModeSchema,
  cleanupMinutes: z.number().int().min(0),
  rescheduleCount: z.number().int().min(0),
  checkedInAt: instantSchema.nullable(),
  source: bookingSourceSchema,
  charges: z.array(
    z.object({
      id: idSchema,
      purpose: chargePurposeSchema,
      method: chargeMethodSchema,
      amountCents: positiveCentsSchema,
      status: chargeStatusSchema,
      createdAt: instantSchema,
      approvedAt: instantSchema.nullable(),
    }),
  ),
  refunds: z.array(
    z.object({
      id: idSchema,
      amountCents: positiveCentsSchema,
      status: z.enum(['pending', 'approved', 'failed']),
      createdAt: instantSchema,
    }),
  ),
  pendingReschedule: z
    .object({
      id: idSchema,
      startsAt: instantSchema,
      endsAt: instantSchema,
      payNowCents: positiveCentsSchema,
      expiresAt: instantSchema,
      chargeId: idSchema,
    })
    .nullable(),
  policy: z.object({ version: z.number().int().min(1), sections: z.array(policySectionSchema) }),
  actions: z.object({
    canPay: z.boolean(),
    canPayBalance: z.boolean(),
    canReschedule: z.boolean(),
    rescheduleBlockedReason: z
      .enum(['too_late', 'limit_reached', 'status', 'payment_mode'])
      .nullable(),
    canCancel: z.boolean(),
  }),
});
export type BookingDetail = z.infer<typeof bookingDetailSchema>;

export const chargeIntentSchema = z.object({
  chargeId: idSchema,
  method: payMethodSchema,
  status: chargeStatusSchema,
  amountCents: positiveCentsSchema,
  expiresAt: instantSchema.nullable(),
  pixQrCodeBase64: z.string().nullable(),
  pixCopyPaste: z.string().nullable(),
  checkoutUrl: z.string().nullable(),
});
export type ChargeIntent = z.infer<typeof chargeIntentSchema>;

export const affectedBookingSchema = z.object({
  id: idSchema,
  code: bookingCodeSchema,
  customerName: z.string(),
  roomName: z.string().min(1),
  startsAt: instantSchema,
  endsAt: instantSchema,
  status: bookingStatusSchema,
});
export type AffectedBooking = z.infer<typeof affectedBookingSchema>;

/** Error envelope of every non-2xx response (docs/architecture.md section 6.2). */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string().regex(/^[A-Z][A-Z_]*$/),
    message: z.string().min(1),
    details: z.unknown().optional(),
    requestId: z.string().min(1),
  }),
});
export type ApiErrorBody = z.infer<typeof apiErrorSchema>;

/** `details` of 409 `AFFECTED_BOOKINGS` (NUC-34). */
export const affectedBookingsDetailsSchema = z.object({
  bookings: z.array(affectedBookingSchema).min(1),
});

/** `details` of 409 `CLEANUP_CONFLICTS` (NUC-37): each pair names both bookings. */
export const cleanupConflictsDetailsSchema = z.object({
  pairs: z.array(z.object({ first: affectedBookingSchema, second: affectedBookingSchema })).min(1),
});
