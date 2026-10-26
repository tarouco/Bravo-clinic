import { localDateSchema, quoteStatusSchema } from '@bravo/core';
import { z } from 'zod';

// Response shapes of the gestao extra-service and quote-request admin routes (gestao design
// "Admin operations services"). Core owns the request schemas; the responses are declared here so
// the MSW fixtures are validated against them (AD-035). The fields the design leaves open are
// listed in the design's "Web-assumed API contract" section.

export const extraServiceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  /** Cents; null means "Sob consulta". */
  referencePriceCents: z.number().int().min(0).nullable(),
  unit: z.enum(['hour', 'project']),
  saleMode: z.enum(['quote', 'online']),
  status: z.enum(['active', 'inactive']),
  displayOrder: z.number().int().min(0),
});
export type ExtraService = z.infer<typeof extraServiceSchema>;
export const extraServiceListSchema = z.object({ items: z.array(extraServiceSchema) });

export const quoteRequestSchema = z.object({
  id: z.string().min(1),
  status: quoteStatusSchema,
  serviceId: z.string().min(1),
  serviceName: z.string().min(1),
  name: z.string().min(1),
  phone: z.string().min(1),
  email: z.string().nullable(),
  description: z.string().min(1),
  desiredOn: localDateSchema.nullable(),
  /** Code of the linked booking (BRV-...), when the request came from a booking. */
  bookingCode: z.string().nullable(),
  staffNotes: z.string().nullable(),
  createdAt: z.string().min(1),
});
export type QuoteRequest = z.infer<typeof quoteRequestSchema>;
export const quoteRequestPageSchema = z.object({
  items: z.array(quoteRequestSchema),
  nextCursor: z.string().nullable(),
});
export type QuoteRequestPage = z.infer<typeof quoteRequestPageSchema>;
