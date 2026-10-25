import { z } from 'zod';
import {
  bookingCodeSchema,
  businessHoursRowSchema,
  centsSchema,
  chargeStatusSchema,
  chargePurposeSchema,
  idSchema,
  instantSchema,
  localDateSchema,
  minuteOfDaySchema,
  monthSchema,
  payMethodSchema,
  photoSchema,
  policySectionSchema,
  policySnapshotSchema,
  positiveCentsSchema,
  publicCellSchema,
  roomSlugSchema,
  roomSummarySchema,
  weekdaysSchema,
  windowSchema,
} from './common';

// Public endpoints (`/api/public`, no auth) of design.md section "API Contract".

export const roomListSchema = z.object({ items: z.array(roomSummarySchema) });
export type RoomList = z.infer<typeof roomListSchema>;

export const roomDetailSchema = roomSummarySchema.extend({ photos: z.array(photoSchema) });
export type RoomDetail = z.infer<typeof roomDetailSchema>;

export const catalogSchema = z.object({
  hourly: z.array(
    z.object({
      id: idSchema,
      name: z.string().min(1),
      weekdays: weekdaysSchema,
      appliesOnHolidays: z.boolean(),
      startMinute: minuteOfDaySchema,
      endMinute: minuteOfDaySchema,
      weekdayRateCents: positiveCentsSchema,
      weekendRateCents: positiveCentsSchema,
      minDurationMinutes: z.number().int().positive(),
      displayOrder: z.number().int(),
      isReference: z.boolean(),
    }),
  ),
  blocks: z.array(
    z.object({
      id: idSchema,
      name: z.string().min(1),
      weekdays: weekdaysSchema,
      appliesOnHolidays: z.boolean(),
      startMinute: minuteOfDaySchema,
      endMinute: minuteOfDaySchema,
      fixedPriceCents: positiveCentsSchema,
      averageHourlyCents: centsSchema,
    }),
  ),
  pricesReviewed: z.boolean(),
});
export type Catalog = z.infer<typeof catalogSchema>;

export const clinicSchema = z.object({
  addressLine: z.string(),
  whatsappE164: z.string(),
  contactEmail: z.string(),
  businessHours: z.array(businessHoursRowSchema).length(8),
});
export type Clinic = z.infer<typeof clinicSchema>;

export const policiesPublicSchema = z.object({
  version: z.number().int().min(1),
  values: policySnapshotSchema,
  sections: z.array(policySectionSchema).min(1),
});
export type PoliciesPublic = z.infer<typeof policiesPublicSchema>;

export const availabilityDayQuerySchema = z.object({ date: localDateSchema });
export const availabilityMonthQuerySchema = z.object({ month: monthSchema });

export const blockOptionSchema = z.strictObject({
  categoryId: idSchema,
  name: z.string().min(1),
  startMinute: minuteOfDaySchema,
  endMinute: minuteOfDaySchema,
  priceCents: positiveCentsSchema,
  available: z.boolean(),
});

/** Public day availability; strict, so admin-only fields fail the parse (NUC-77). */
export const availabilityDaySchema = z.strictObject({
  date: localDateSchema,
  roomSlug: roomSlugSchema,
  isHoliday: z.boolean(),
  holidayName: z.string().nullable(),
  closed: z.boolean(),
  outOfRange: z.boolean(),
  window: windowSchema.nullable(),
  slotMinutes: z.number().int().positive(),
  minBookingMinutes: z.number().int().positive(),
  cells: z.array(publicCellSchema),
  blockOptions: z.array(blockOptionSchema),
});
export type AvailabilityDay = z.infer<typeof availabilityDaySchema>;

export const monthDayStatusSchema = z.enum(['available', 'full', 'closed', 'past', 'out_of_range']);

export const availabilityMonthSchema = z.object({
  month: monthSchema,
  days: z.array(
    z.object({
      date: localDateSchema,
      status: monthDayStatusSchema,
      isHoliday: z.boolean(),
      holidayName: z.string().nullable(),
      hasDiscount: z.boolean(),
    }),
  ),
});
export type AvailabilityMonth = z.infer<typeof availabilityMonthSchema>;

export const quoteRequestSchema = z
  .object({
    roomSlug: roomSlugSchema,
    date: localDateSchema,
    startMinute: minuteOfDaySchema,
    endMinute: minuteOfDaySchema,
    blockCategoryId: idSchema.optional(),
    couponCode: z.string().trim().min(1).max(40).optional(),
    useCredits: z.boolean().optional(),
    payWith: z.enum(['money', 'package']).optional(),
    addons: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((q) => q.endMinute > q.startMinute, {
    error: 'O fim precisa ser depois do início',
    path: ['endMinute'],
  });
export type QuoteRequest = z.infer<typeof quoteRequestSchema>;

export const preReservationPublicSchema = z.object({
  bookingId: idSchema,
  code: bookingCodeSchema,
  roomName: z.string().min(1),
  startsAt: instantSchema,
  endsAt: instantSchema,
  totalCents: centsSchema,
  holdExpiresAt: instantSchema,
  customerFirstName: z.string(),
});
export type PreReservationPublic = z.infer<typeof preReservationPublicSchema>;

export const paymentConfigSchema = z.object({
  provider: z.enum(['sandbox', 'mercadopago']),
  publicKey: z.string().min(1).nullable(),
  environment: z.enum(['test', 'production']),
});
export type PaymentConfig = z.infer<typeof paymentConfigSchema>;

export const sandboxChargeSchema = z.object({
  id: idSchema,
  amountCents: positiveCentsSchema,
  method: payMethodSchema,
  status: chargeStatusSchema,
  purpose: chargePurposeSchema,
  bookingCode: bookingCodeSchema.nullable(),
  bookingId: idSchema.nullable(),
  expiresAt: instantSchema.nullable(),
  pixCopyPaste: z.string().nullable(),
});
export type SandboxCharge = z.infer<typeof sandboxChargeSchema>;

export const sandboxActionRequestSchema = z.object({});
export const sandboxActionSchema = z.object({ status: chargeStatusSchema });
