import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import type {
  AdminAvailabilityDay,
  BusinessHoursUpdate,
  CalendarConfig,
  CalendarEvents,
  CalendarSettings,
  Holiday,
  blockCreateResultSchema,
  blockCreateSchema,
  blockListSchema,
  blockRecurrenceCreateResultSchema,
  blockRecurrenceCreateSchema,
  blockRecurrenceListSchema,
  businessHoursResponseSchema,
  calendarEventsQuerySchema,
  calendarSettingsResultSchema,
  closedDayCreateResultSchema,
  closedDayCreateSchema,
  closedDayListSchema,
  closedDayPreviewSchema,
  holidayCreateSchema,
  holidayImportResultSchema,
  holidayListSchema,
  holidayUpdateSchema,
} from '@bravo/core';
import { api } from '../../lib/api';
import { withQuery } from '../../lib/query-string';
import { availabilityKeys } from '../availability/api';

// Admin Calendário hooks (design.md "API Contract / Admin"). All keys start with ['admin', 'calendar'].

export const calendarKeys = {
  all: ['admin', 'calendar'] as const,
  config: ['admin', 'calendar', 'config'] as const,
  holidays: (year: number) => ['admin', 'calendar', 'holidays', year] as const,
  closedDays: (from: string, to: string) => ['admin', 'calendar', 'closed-days', from, to] as const,
  closedDayPreview: (date: string, roomIds: string[] | null) =>
    ['admin', 'calendar', 'closed-day-preview', date, roomIds] as const,
  blocks: (from: string, to: string, roomId: string | undefined) =>
    ['admin', 'calendar', 'blocks', from, to, roomId] as const,
  recurrences: ['admin', 'calendar', 'block-recurrences'] as const,
  events: (filters: CalendarEventsFilters) => ['admin', 'calendar', 'events', filters] as const,
  day: (roomId: string, date: string) => ['admin', 'calendar', 'day', roomId, date] as const,
};

export type CalendarEventsFilters = z.input<typeof calendarEventsQuerySchema>;

/** Calendar changes alter what the public site offers, so availability is refetched too. */
function useInvalidateCalendar() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: calendarKeys.all });
    void queryClient.invalidateQueries({ queryKey: availabilityKeys.all });
  };
}

export function useCalendarConfig() {
  return useQuery<CalendarConfig>({
    queryKey: calendarKeys.config,
    queryFn: () => api.get<CalendarConfig>('/api/admin/calendar/config'),
  });
}

export function useUpdateBusinessHours() {
  const invalidate = useInvalidateCalendar();
  return useMutation<z.infer<typeof businessHoursResponseSchema>, Error, BusinessHoursUpdate>({
    mutationFn: (input) => api.put('/api/admin/calendar/business-hours', input),
    onSuccess: invalidate,
  });
}

export function useUpdateCalendarSettings() {
  const invalidate = useInvalidateCalendar();
  return useMutation<z.infer<typeof calendarSettingsResultSchema>, Error, CalendarSettings>({
    mutationFn: (input) => api.put('/api/admin/calendar/settings', input),
    onSuccess: invalidate,
  });
}

export function useHolidays(year: number) {
  return useQuery<z.infer<typeof holidayListSchema>>({
    queryKey: calendarKeys.holidays(year),
    queryFn: () => api.get(withQuery('/api/admin/calendar/holidays', { year })),
  });
}

export function useCreateHoliday() {
  const invalidate = useInvalidateCalendar();
  return useMutation<Holiday, Error, z.input<typeof holidayCreateSchema>>({
    mutationFn: (input) => api.post('/api/admin/calendar/holidays', input),
    onSuccess: invalidate,
  });
}

export function useUpdateHoliday(id: string) {
  const invalidate = useInvalidateCalendar();
  return useMutation<Holiday, Error, z.input<typeof holidayUpdateSchema>>({
    mutationFn: (input) => api.patch(`/api/admin/calendar/holidays/${id}`, input),
    onSuccess: invalidate,
  });
}

export function useDeleteHoliday() {
  const invalidate = useInvalidateCalendar();
  return useMutation<void, Error, string>({
    mutationFn: (id) => api.delete(`/api/admin/calendar/holidays/${id}`),
    onSuccess: invalidate,
  });
}

export function useImportHolidays() {
  const invalidate = useInvalidateCalendar();
  return useMutation<z.infer<typeof holidayImportResultSchema>, Error, { year: number }>({
    mutationFn: (input) => api.post('/api/admin/calendar/holidays/import', input),
    onSuccess: invalidate,
  });
}

export function useClosedDays(from: string, to: string) {
  return useQuery<z.infer<typeof closedDayListSchema>>({
    queryKey: calendarKeys.closedDays(from, to),
    queryFn: () => api.get(withQuery('/api/admin/calendar/closed-days', { from, to })),
  });
}

/** Bookings affected and compensation totals before closing `date`; null `roomIds` = whole clinic. */
export function useClosedDayPreview(date: string | null, roomIds: string[] | null) {
  return useQuery<z.infer<typeof closedDayPreviewSchema>>({
    queryKey: calendarKeys.closedDayPreview(date ?? '', roomIds),
    enabled: date !== null,
    queryFn: () =>
      api.get(
        withQuery('/api/admin/calendar/closed-days/preview', {
          date,
          roomIds: roomIds?.join(','),
        }),
      ),
  });
}

export function useCreateClosedDay() {
  const invalidate = useInvalidateCalendar();
  return useMutation<
    z.infer<typeof closedDayCreateResultSchema>,
    Error,
    z.input<typeof closedDayCreateSchema>
  >({
    mutationFn: (input) => api.post('/api/admin/calendar/closed-days', input),
    onSuccess: invalidate,
  });
}

export function useDeleteClosedDay() {
  const invalidate = useInvalidateCalendar();
  return useMutation<void, Error, string>({
    mutationFn: (id) => api.delete(`/api/admin/calendar/closed-days/${id}`),
    onSuccess: invalidate,
  });
}

export function useBlocks(range: { from: string; to: string; roomId?: string }) {
  return useQuery<z.infer<typeof blockListSchema>>({
    queryKey: calendarKeys.blocks(range.from, range.to, range.roomId),
    queryFn: () => api.get(withQuery('/api/admin/blocks', range)),
  });
}

export function useCreateBlocks() {
  const invalidate = useInvalidateCalendar();
  return useMutation<
    z.infer<typeof blockCreateResultSchema>,
    Error,
    z.input<typeof blockCreateSchema>
  >({
    mutationFn: (input) => api.post('/api/admin/blocks', input),
    onSuccess: invalidate,
  });
}

export function useDeleteBlock() {
  const invalidate = useInvalidateCalendar();
  return useMutation<void, Error, string>({
    mutationFn: (id) => api.delete(`/api/admin/blocks/${id}`),
    onSuccess: invalidate,
  });
}

export function useBlockRecurrences() {
  return useQuery<z.infer<typeof blockRecurrenceListSchema>>({
    queryKey: calendarKeys.recurrences,
    queryFn: () => api.get('/api/admin/block-recurrences'),
  });
}

export function useCreateRecurrence() {
  const invalidate = useInvalidateCalendar();
  return useMutation<
    z.infer<typeof blockRecurrenceCreateResultSchema>,
    Error,
    z.input<typeof blockRecurrenceCreateSchema>
  >({
    mutationFn: (input) => api.post('/api/admin/block-recurrences', input),
    onSuccess: invalidate,
  });
}

export function useDeleteRecurrence() {
  const invalidate = useInvalidateCalendar();
  return useMutation<void, Error, string>({
    mutationFn: (id) => api.delete(`/api/admin/block-recurrences/${id}`),
    onSuccess: invalidate,
  });
}

/** Bookings, blocks, closed days and holidays of a range of at most 42 days. */
export function useCalendarEvents(filters: CalendarEventsFilters) {
  return useQuery<CalendarEvents>({
    queryKey: calendarKeys.events(filters),
    queryFn: () => api.get(withQuery('/api/admin/calendar/events', filters)),
  });
}

/** Admin cells (with `adminState`) of one room and day. */
export function useAdminDayAvailability(roomId: string | undefined, date: string | undefined) {
  return useQuery<AdminAvailabilityDay>({
    queryKey: calendarKeys.day(roomId ?? '', date ?? ''),
    enabled: Boolean(roomId) && Boolean(date),
    staleTime: 15 * 1000,
    queryFn: () => api.get(withQuery(`/api/admin/rooms/${roomId ?? ''}/availability`, { date })),
  });
}
