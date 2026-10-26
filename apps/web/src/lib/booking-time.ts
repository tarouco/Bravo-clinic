import { utcToLocal } from '@bravo/core';
import { formatLocalDateBR, formatMinuteRange } from './format';

/** "27/10/2026 · 17:30–20:00" in São Paulo time; a booking ending at midnight reads "–24:00". */
export function bookingWhen(startsAt: string, endsAt: string): string {
  const start = utcToLocal(new Date(startsAt));
  const end = utcToLocal(new Date(endsAt));
  const endMinute = end.date !== start.date && end.minuteOfDay === 0 ? 1440 : end.minuteOfDay;
  return `${formatLocalDateBR(start.date)} · ${formatMinuteRange(start.minuteOfDay, endMinute)}`;
}
