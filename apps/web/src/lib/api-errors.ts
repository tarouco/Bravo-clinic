import {
  affectedBookingsDetailsSchema,
  cleanupConflictsDetailsSchema,
  type AffectedBooking,
} from '@bravo/core';
import { ApiError } from './api';

/**
 * Bookings named by a 409 `AFFECTED_BOOKINGS` (`details.bookings`) or `CLEANUP_CONFLICTS`
 * (`details.pairs`, each booking once); null when the error is neither. A body the contract does
 * not recognise still yields an empty list so the caller can open its dialog with the message.
 */
export function affectedBookingsOf(error: unknown): AffectedBooking[] | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  if (error.code === 'AFFECTED_BOOKINGS') {
    const parsed = affectedBookingsDetailsSchema.safeParse(error.details);
    return parsed.success ? parsed.data.bookings : [];
  }
  if (error.code === 'CLEANUP_CONFLICTS') {
    const parsed = cleanupConflictsDetailsSchema.safeParse(error.details);
    if (!parsed.success) return [];
    const byId = new Map<string, AffectedBooking>();
    for (const pair of parsed.data.pairs) {
      byId.set(pair.first.id, pair.first);
      byId.set(pair.second.id, pair.second);
    }
    return [...byId.values()];
  }
  return null;
}

/** Field messages of a 422 envelope (`details: [{ path, message }]`) keyed by path. */
export function fieldErrorsOf(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError) || !Array.isArray(error.details)) return {};
  const out: Record<string, string> = {};
  for (const detail of error.details) {
    const { path, message } = detail as { path?: unknown; message?: unknown };
    if (typeof path === 'string' && typeof message === 'string' && !(path in out)) {
      out[path] = message;
    }
  }
  return out;
}

/** The API message of an `ApiError`, or `fallback` for anything else. */
export function messageOf(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}
