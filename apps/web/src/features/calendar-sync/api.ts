import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import type { CalendarFeedIssued, CalendarFeedStatus } from './contracts';

export const calendarFeedKey = ['app', 'calendar-feed'] as const;

/** `GET /api/app/calendar-feed`: whether the tenant has an active personal feed (GES-45). */
export function useCalendarFeed() {
  return useQuery<CalendarFeedStatus>({
    queryKey: calendarFeedKey,
    queryFn: () => api.get('/api/app/calendar-feed'),
  });
}

/** `POST /api/app/calendar-feed`: creates or regenerates the feed and returns its URL once. */
export function useIssueCalendarFeed() {
  const queryClient = useQueryClient();
  return useMutation<CalendarFeedIssued, Error, void>({
    mutationFn: () => api.post('/api/app/calendar-feed'),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: calendarFeedKey }),
  });
}
