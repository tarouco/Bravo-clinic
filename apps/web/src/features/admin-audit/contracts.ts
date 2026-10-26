import { auditOriginSchema } from '@bravo/core';
import { z } from 'zod';

// Response shape of `GET /api/admin/audit` (gestao design "Admin operations services"). Core owns
// the query schema; the response is declared here so the MSW fixtures are validated against it
// (AD-035). The fields the design leaves open are listed in the design's "Web-assumed API
// contract" section.

export const auditRowSchema = z.object({
  id: z.number().int().min(1),
  at: z.string().min(1),
  /** Null for system and job actions that have no user. */
  actorUserId: z.string().nullable(),
  actorName: z.string().nullable(),
  actorRole: z.string().nullable(),
  origin: auditOriginSchema,
  action: z.string().min(1),
  entityType: z.string().min(1),
  entityId: z.string().nullable(),
  justification: z.string().nullable(),
  /** Entity state before and after the action; `null` when the action has no such state. */
  before: z.unknown(),
  after: z.unknown(),
});
export type AuditRow = z.infer<typeof auditRowSchema>;

export const auditPageSchema = z.object({
  items: z.array(auditRowSchema),
  nextCursor: z.string().nullable(),
});
export type AuditPage = z.infer<typeof auditPageSchema>;
