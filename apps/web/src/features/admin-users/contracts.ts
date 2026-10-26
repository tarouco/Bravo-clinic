import { staffRoleSchema } from '@bravo/core';
import { z } from 'zod';

// Response shapes of the gestao Usuários routes (gestao design "Admin operations services").
// Core owns the request schemas; the responses are declared here so the MSW fixtures are
// validated against them (AD-035). The fields the design leaves open are listed in the design's
// "Web-assumed API contract" section.

export const staffUserSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  email: z.string().min(1),
  role: staffRoleSchema,
  status: z.enum(['active', 'disabled']),
  /** The user confirmed a second factor (`user_totp.confirmed_at`). */
  totpConfirmed: z.boolean(),
  lastLoginAt: z.string().nullable(),
});
export type StaffUser = z.infer<typeof staffUserSchema>;

/** `GET /api/admin/users`: every staff account (admin and reception), disabled ones included. */
export const staffUserListSchema = z.object({ items: z.array(staffUserSchema) });
export type StaffUserList = z.infer<typeof staffUserListSchema>;
