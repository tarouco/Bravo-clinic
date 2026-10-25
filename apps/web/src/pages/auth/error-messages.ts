import type { ApiError } from '../../lib/api';

/** Lockout message for a 429: waits are shown in whole minutes, at least one. */
export function tooManyAttemptsMessage(error: ApiError): string {
  const minutes = Math.max(1, Math.ceil((error.retryAfterSeconds ?? 60) / 60));
  return `Muitas tentativas. Tente novamente em ${String(minutes)} minutos.`;
}
