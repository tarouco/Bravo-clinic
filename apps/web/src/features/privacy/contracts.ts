import { z } from 'zod';

// Response shape of `GET /api/app/me/consents` (gestao design "Privacy (LGPD)"); the design
// names the route only, the shape is listed in its "Web-assumed API contract" section.

export const consentSchema = z.object({
  id: z.string().min(1),
  /** `booking_policy`, `recurring_charge`, `subscription_terms`, ... */
  kind: z.string().min(1),
  version: z.number().int().min(1),
  acceptedAt: z.string().min(1),
});
export type Consent = z.infer<typeof consentSchema>;
export const consentListSchema = z.object({ items: z.array(consentSchema) });
export type ConsentList = z.infer<typeof consentListSchema>;
