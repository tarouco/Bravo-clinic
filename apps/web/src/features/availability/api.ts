import { useQuery } from '@tanstack/react-query';
import type { AvailabilityDay, AvailabilityMonth } from '@bravo/core';
import { api } from '../../lib/api';
import { withQuery } from '../../lib/query-string';

// Availability changes with every booking: 15 s (docs/architecture.md section 9.2).
const FIFTEEN_SECONDS_MS = 15 * 1000;

export const availabilityKeys = {
  all: ['public', 'availability'] as const,
  day: (roomSlug: string, date: string) => ['public', 'availability', roomSlug, date] as const,
  month: (roomSlug: string, month: string) =>
    ['public', 'availability-month', roomSlug, month] as const,
};

/** Cells and block options of one room on one day (`date` is `YYYY-MM-DD`). */
export function useDayAvailability(roomSlug: string | undefined, date: string | undefined) {
  return useQuery<AvailabilityDay>({
    queryKey: availabilityKeys.day(roomSlug ?? '', date ?? ''),
    enabled: Boolean(roomSlug) && Boolean(date),
    staleTime: FIFTEEN_SECONDS_MS,
    queryFn: () =>
      api.get<AvailabilityDay>(
        withQuery(`/api/public/rooms/${encodeURIComponent(roomSlug ?? '')}/availability`, { date }),
      ),
  });
}

/** Day statuses of one month (`month` is `YYYY-MM`). */
export function useMonthAvailability(roomSlug: string | undefined, month: string | undefined) {
  return useQuery<AvailabilityMonth>({
    queryKey: availabilityKeys.month(roomSlug ?? '', month ?? ''),
    enabled: Boolean(roomSlug) && Boolean(month),
    staleTime: FIFTEEN_SECONDS_MS,
    queryFn: () =>
      api.get<AvailabilityMonth>(
        withQuery(`/api/public/rooms/${encodeURIComponent(roomSlug ?? '')}/availability/month`, {
          month,
        }),
      ),
  });
}
