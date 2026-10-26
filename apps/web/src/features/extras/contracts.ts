import { localDateSchema, quoteStatusSchema } from '@bravo/core';
import { z } from 'zod';

// Response shapes of the public and tenant extras routes (gestao design "Admin operations
// services"). Core owns the request schemas; the responses are declared here so the MSW fixtures
// are validated against them (AD-035). The fields the design leaves open are listed in its
// "Web-assumed API contract" section.

/** One row of `GET /api/public/extra-services` (GES-86): active services in display order. */
export const publicExtraServiceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  /** Cents; null means "Sob consulta". */
  referencePriceCents: z.number().int().min(0).nullable(),
  unit: z.enum(['hour', 'project']),
  saleMode: z.enum(['quote', 'online']),
});
export type PublicExtraService = z.infer<typeof publicExtraServiceSchema>;
export const publicExtraServiceListSchema = z.object({ items: z.array(publicExtraServiceSchema) });
export type PublicExtraServiceList = z.infer<typeof publicExtraServiceListSchema>;

/** One row of `GET /api/app/quote-requests` (GES-97): the signed-in tenant's own requests. */
export const ownQuoteRequestSchema = z.object({
  id: z.string().min(1),
  status: quoteStatusSchema,
  serviceName: z.string().min(1),
  description: z.string().min(1),
  desiredOn: localDateSchema.nullable(),
  /** Code of the linked booking (BRV-...), when the request was tied to a booking. */
  bookingCode: z.string().nullable(),
  createdAt: z.string().min(1),
});
export type OwnQuoteRequest = z.infer<typeof ownQuoteRequestSchema>;
export const ownQuoteRequestPageSchema = z.object({
  items: z.array(ownQuoteRequestSchema),
  nextCursor: z.string().nullable(),
});
export type OwnQuoteRequestPage = z.infer<typeof ownQuoteRequestPageSchema>;
