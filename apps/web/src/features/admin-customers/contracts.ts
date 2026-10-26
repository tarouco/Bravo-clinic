import {
  bookingStatusSchema,
  couponUseStatusSchema,
  creditSourceSchema,
  extraLotSourceSchema,
  localDateSchema,
  quoteStatusSchema,
  subscriptionStatusSchema,
} from '@bravo/core';
import { z } from 'zod';

// Response shapes of the gestao Clientes routes (gestao design "Admin operations services").
// Core owns the request schemas; the responses are declared here so the MSW fixtures are
// validated against them (AD-035). The fields the design leaves open are listed in the design's
// "Web-assumed API contract" section.

const id = z.string().min(1);

export const customerSummarySchema = z.object({
  id,
  name: z.string().min(1),
  email: z.string().min(1),
  phone: z.string().nullable(),
  /** Document with the middle digits hidden (`***.982.247-**`). */
  docMasked: z.string().nullable(),
});
export type CustomerSummary = z.infer<typeof customerSummarySchema>;

export const customerListSchema = z.object({
  items: z.array(customerSummarySchema),
  nextCursor: z.string().nullable(),
});
export type CustomerList = z.infer<typeof customerListSchema>;

export const customerProfileViewSchema = customerSummarySchema.extend({
  docType: z.enum(['cpf', 'cnpj']).nullable(),
  profession: z.string().nullable(),
  professionalRegistry: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string().min(1),
});
export type CustomerProfileView = z.infer<typeof customerProfileViewSchema>;

export const customerBookingSchema = z.object({
  id,
  code: z.string().min(1),
  roomName: z.string().min(1),
  startsAt: z.string().min(1),
  endsAt: z.string().min(1),
  status: bookingStatusSchema,
  totalCents: z.number().int().min(0),
});
export type CustomerBooking = z.infer<typeof customerBookingSchema>;

export const customerBookingsPageSchema = z.object({
  items: z.array(customerBookingSchema),
  nextCursor: z.string().nullable(),
});
export type CustomerBookingsPage = z.infer<typeof customerBookingsPageSchema>;

export const customerSubscriptionSchema = z.object({
  id,
  categoryName: z.string().min(1),
  roomName: z.string().nullable(),
  status: subscriptionStatusSchema,
  baseOn: localDateSchema,
  nextChargeOn: localDateSchema.nullable(),
  /** Minutes left in the open period. */
  balanceMinutes: z.number().int().min(0),
});

export const customerExtraLotSchema = z.object({
  id,
  source: extraLotSourceSchema,
  remainingMinutes: z.number().int().min(0),
  expiresOn: localDateSchema.nullable(),
});

export const customerCreditSchema = z.object({
  id,
  source: creditSourceSchema,
  remainingCents: z.number().int().min(0),
  expiresOn: localDateSchema.nullable(),
});

export const customerCouponUseSchema = z.object({
  id,
  code: z.string().min(1),
  status: couponUseStatusSchema,
  discountCents: z.number().int().min(0),
  usedAt: z.string().min(1),
});

export const customerConsentSchema = z.object({
  id,
  /** `booking_policy`, `recurring_charge`, `subscription_terms`, ... */
  kind: z.string().min(1),
  version: z.string().min(1),
  acceptedAt: z.string().min(1),
});

export const customerQuoteSchema = z.object({
  id,
  serviceName: z.string().min(1),
  status: quoteStatusSchema,
  createdAt: z.string().min(1),
});

/** `GET /api/admin/customers/:id`: the profile and every section of GES-100. */
export const customerDetailSchema = z.object({
  profile: customerProfileViewSchema,
  /** First page, newest first; `GET /:id/bookings?cursor` returns the next ones. */
  bookings: customerBookingsPageSchema,
  subscriptions: z.array(customerSubscriptionSchema),
  extraLots: z.array(customerExtraLotSchema),
  credits: z.array(customerCreditSchema),
  couponUses: z.array(customerCouponUseSchema),
  consents: z.array(customerConsentSchema),
  quoteRequests: z.array(customerQuoteSchema),
});
export type CustomerDetail = z.infer<typeof customerDetailSchema>;
