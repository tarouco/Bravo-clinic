import { z } from 'zod';
import { ApiError } from './api';

/**
 * What blocks a room inactivation (`ROOM_HAS_FUTURE_COMMITMENTS`, GES-104) or a customer
 * anonymization (`HAS_ACTIVE_COMMITMENTS`, GES-125): the booking codes and subscription ids the
 * admin must resolve first. Carried by the 409 envelope as `details`.
 */
export const commitmentsDetailsSchema = z.object({
  bookings: z.array(z.object({ code: z.string().min(1) })).default([]),
  subscriptions: z.array(z.object({ id: z.string().min(1) })).default([]),
});
export type Commitments = z.infer<typeof commitmentsDetailsSchema>;

const COMMITMENT_CODES = ['ROOM_HAS_FUTURE_COMMITMENTS', 'HAS_ACTIVE_COMMITMENTS'];

/** The commitments of such a 409, or null for any other error. An unreadable body yields none. */
export function commitmentsOf(error: unknown): Commitments | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  if (!COMMITMENT_CODES.includes(error.code)) return null;
  const parsed = commitmentsDetailsSchema.safeParse(error.details);
  return parsed.success ? parsed.data : { bookings: [], subscriptions: [] };
}
