import { z } from 'zod';
import {
  emailSchema,
  phoneSchema,
  totpCodeSchema,
  DOCUMENT_MESSAGE,
} from '../validation/auth-schemas';
import { parseDocument } from '../validation/document';
import {
  bookingDetailSchema,
  bookingSummarySchema,
  centsSchema,
  chargeIntentSchema,
  idSchema,
  instantSchema,
  localDateSchema,
  minuteOfDaySchema,
  payMethodSchema,
  quoteSchema,
  rejectReasonSchema,
  roomSlugSchema,
} from './common';
import { quoteRequestSchema } from './public';

// Tenant app endpoints (`/api/app`, session) of design.md section "API Contract".

export const createBookingSchema = quoteRequestSchema.extend({
  acceptPolicy: z.literal(true, { error: 'Aceite a política de reserva para continuar' }),
  policyVersion: z.number().int().min(1),
  expectedTotalCents: centsSchema,
});
export type CreateBookingInput = z.infer<typeof createBookingSchema>;

export const bookingTabSchema = z.enum(['upcoming', 'past', 'cancelled']);
export const bookingListQuerySchema = z.object({
  tab: bookingTabSchema,
  cursor: z.string().min(1).optional(),
});

export const bookingListSchema = z.object({
  items: z.array(bookingSummarySchema),
  nextCursor: z.string().min(1).nullable(),
});
export type BookingList = z.infer<typeof bookingListSchema>;

const savedCardRequired = (r: { method: string; savedCardId?: string | undefined }) =>
  r.method !== 'saved_card' || r.savedCardId !== undefined;

export const payRequestSchema = z
  .object({
    method: payMethodSchema,
    savedCardId: idSchema.optional(),
    acceptPolicy: z.boolean().optional(),
    policyVersion: z.number().int().min(1).optional(),
  })
  .refine(savedCardRequired, { error: 'Escolha o cartão salvo', path: ['savedCardId'] });
export type PayRequest = z.infer<typeof payRequestSchema>;

export const payBalanceRequestSchema = z
  .object({ method: payMethodSchema, savedCardId: idSchema.optional() })
  .refine(savedCardRequired, { error: 'Escolha o cartão salvo', path: ['savedCardId'] });
export type PayBalanceRequest = z.infer<typeof payBalanceRequestSchema>;

export const rescheduleQuoteRequestSchema = z
  .object({
    roomSlug: roomSlugSchema.optional(),
    date: localDateSchema,
    startMinute: minuteOfDaySchema,
    endMinute: minuteOfDaySchema,
  })
  .refine((r) => r.endMinute > r.startMinute, {
    error: 'O fim precisa ser depois do início',
    path: ['endMinute'],
  });
export type RescheduleQuoteRequest = z.infer<typeof rescheduleQuoteRequestSchema>;

export const rescheduleBlockReasonSchema = z.enum([
  'too_late',
  'limit_reached',
  'beyond_window',
  'unsupported_payment_mode',
  'no_category',
  ...rejectReasonSchema.options,
]);

export const rescheduleSettlementSchema = z.object({
  payNowCents: centsSchema,
  creditCents: centsSchema,
  newTotalCents: centsSchema,
  newBalanceCents: centsSchema,
});

export const rescheduleQuoteSchema = z.object({
  allowed: z.boolean(),
  reason: rescheduleBlockReasonSchema.nullable(),
  message: z.string().nullable(),
  newQuote: quoteSchema.nullable(),
  settlement: rescheduleSettlementSchema.nullable(),
});
export type RescheduleQuote = z.infer<typeof rescheduleQuoteSchema>;

export const rescheduleRequestSchema = rescheduleQuoteRequestSchema.extend({
  method: payMethodSchema.optional(),
  savedCardId: idSchema.optional(),
});
export type RescheduleRequest = z.infer<typeof rescheduleRequestSchema>;

/** 200: moved at once (with credit); 202: the difference must be paid first. */
export const rescheduleResultSchema = z.union([
  bookingDetailSchema.extend({ creditCents: centsSchema }),
  z.object({
    rescheduleRequestId: idSchema,
    expiresAt: instantSchema,
    charge: chargeIntentSchema,
  }),
]);
export type RescheduleResult = z.infer<typeof rescheduleResultSchema>;

export const cancellationPreviewSchema = z.object({
  retainedCents: centsSchema,
  refundCents: centsSchema,
  minutesReturned: z.number().int().min(0),
  creditCents: centsSchema,
});
export type CancellationPreview = z.infer<typeof cancellationPreviewSchema>;

export const cancelRequestSchema = z.object({ reason: z.string().trim().max(500).optional() });

export const savedCardSchema = z.object({
  id: idSchema,
  brand: z.string().min(1),
  last4: z.string().regex(/^\d{4}$/),
  expMonth: z.number().int().min(1).max(12),
  expYear: z.number().int().min(2000).max(2100),
  recurringConsentAt: instantSchema.nullable(),
});
export type SavedCard = z.infer<typeof savedCardSchema>;

export const savedCardListSchema = z.object({ items: z.array(savedCardSchema) });

export const saveCardSchema = z.object({
  cardToken: z.string().min(1).max(200),
  recurringConsent: z.literal(true, {
    error: 'Autorize as cobranças automáticas para salvar o cartão',
  }),
});
export type SaveCardInput = z.infer<typeof saveCardSchema>;

function optionalProfileText(max: number) {
  return z
    .string()
    .trim()
    .max(max, { error: `Use no máximo ${String(max)} caracteres` })
    .optional();
}

export const updateMeSchema = z.strictObject({
  name: z
    .string()
    .trim()
    .min(2, { error: 'Informe seu nome completo' })
    .max(120, { error: 'Use no máximo 120 caracteres' })
    .optional(),
  phone: phoneSchema.optional(),
  profession: optionalProfileText(80),
  professionalRegistry: optionalProfileText(40),
  document: z
    .string({ error: DOCUMENT_MESSAGE })
    .trim()
    .refine((v) => parseDocument(v) !== null, { error: DOCUMENT_MESSAGE })
    .optional(),
});
export type UpdateMeInput = z.infer<typeof updateMeSchema>;

/** The FND-57 session payload plus the profile fields núcleo edits. */
export const meSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  email: emailSchema,
  role: z.enum(['tenant', 'reception', 'admin']),
  emailVerified: z.boolean(),
  docType: z.enum(['cpf', 'cnpj']).nullable(),
  mfa: z.object({ enrolled: z.boolean(), verified: z.boolean() }),
  phone: z.string().nullable(),
  profession: z.string().nullable(),
  professionalRegistry: z.string().nullable(),
  document: z
    .string()
    .regex(/^(\d{11}|\d{14})$/)
    .nullable(),
});
export type Me = z.infer<typeof meSchema>;

/** `POST /app/auth/totp/disable` (FND-136): a current TOTP code or an unused recovery code. */
export const totpDisableRequestSchema = z.object({ code: totpCodeSchema });
export type TotpDisableRequest = z.infer<typeof totpDisableRequestSchema>;

/** Two-factor authentication is off: the session payload's `mfa` after a disable (FND-136). */
export const totpDisableResponseSchema = z.strictObject({
  mfa: z.strictObject({ enrolled: z.literal(false), verified: z.literal(false) }),
});
export type TotpDisableResponse = z.infer<typeof totpDisableResponseSchema>;
