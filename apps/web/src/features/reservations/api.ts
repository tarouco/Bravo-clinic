import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import type {
  AdminBookingDetail,
  BookingDetail,
  StaffCreateBookingInput,
  adminBookingListSchema,
  adminBookingsQuerySchema,
  adminCancelSchema,
  adminCancellationPreviewSchema,
  adminRescheduleResultSchema,
  adminRescheduleSchema,
  cleanupExceptionSchema,
  confirmManualSchema,
  resendLinkResultSchema,
  staffBookingCreatedSchema,
} from '@bravo/core';
import { api } from '../../lib/api';
import { withQuery } from '../../lib/query-string';
import { availabilityKeys } from '../availability/api';
import { calendarKeys } from '../calendar/api';

// Admin Gestão de Reservas hooks: bookings list, detail and staff actions.

export type AdminBookingFilters = Omit<z.input<typeof adminBookingsQuerySchema>, 'cursor'>;
type AdminBookingList = z.infer<typeof adminBookingListSchema>;

export const reservationKeys = {
  all: ['admin', 'bookings'] as const,
  list: (filters: AdminBookingFilters) => ['admin', 'bookings', 'list', filters] as const,
  detail: (id: string) => ['admin', 'bookings', 'detail', id] as const,
  cancellationPreview: (id: string) => ['admin', 'bookings', 'cancellation-preview', id] as const,
};

/** Staff actions change bookings, the calendar feed and what the public grid offers. */
function useInvalidateReservations() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: reservationKeys.all });
    void queryClient.invalidateQueries({ queryKey: calendarKeys.all });
    void queryClient.invalidateQueries({ queryKey: availabilityKeys.all });
  };
}

/** Download URL of the CSV export for the same filters as the list. */
export function adminBookingsCsvUrl(filters: AdminBookingFilters): string {
  return withQuery('/api/admin/bookings/export.csv', filters);
}

/** Cursor-paginated list ("Carregar mais"), filters kept by the caller in the URL. */
export function useAdminBookings(filters: AdminBookingFilters) {
  return useInfiniteQuery<
    AdminBookingList,
    Error,
    { pages: AdminBookingList[] },
    readonly unknown[],
    string | null
  >({
    queryKey: reservationKeys.list(filters),
    initialPageParam: null,
    getNextPageParam: (last) => last.nextCursor,
    queryFn: ({ pageParam }) =>
      api.get<AdminBookingList>(
        withQuery('/api/admin/bookings', { ...filters, cursor: pageParam }),
      ),
  });
}

export function useAdminBooking(id: string | null) {
  return useQuery<AdminBookingDetail>({
    queryKey: reservationKeys.detail(id ?? ''),
    enabled: id !== null,
    queryFn: () => api.get<AdminBookingDetail>(`/api/admin/bookings/${id ?? ''}`),
  });
}

/** Booking or pre-reservation made at the counter; returns the payment link when one exists. */
export function useStaffCreateBooking() {
  const invalidate = useInvalidateReservations();
  return useMutation<z.infer<typeof staffBookingCreatedSchema>, Error, StaffCreateBookingInput>({
    mutationFn: (input) => api.post('/api/admin/bookings', input),
    onSuccess: invalidate,
  });
}

export function useConfirmManual(id: string) {
  const invalidate = useInvalidateReservations();
  return useMutation<BookingDetail, Error, z.input<typeof confirmManualSchema>>({
    mutationFn: (input) => api.post(`/api/admin/bookings/${id}/confirm-manual`, input),
    onSuccess: invalidate,
  });
}

export function useResendLink(id: string) {
  return useMutation<z.infer<typeof resendLinkResultSchema>, Error, void>({
    mutationFn: () => api.post(`/api/admin/bookings/${id}/resend-link`, {}),
  });
}

export function useCheckIn(id: string) {
  const invalidate = useInvalidateReservations();
  return useMutation<BookingDetail, Error, void>({
    mutationFn: () => api.post(`/api/admin/bookings/${id}/check-in`, {}),
    onSuccess: invalidate,
  });
}

export function useSetCleanup(id: string) {
  const invalidate = useInvalidateReservations();
  return useMutation<BookingDetail, Error, z.input<typeof cleanupExceptionSchema>>({
    mutationFn: (input) => api.patch(`/api/admin/bookings/${id}/cleanup`, input),
    onSuccess: invalidate,
  });
}

export function useAdminReschedule(id: string) {
  const invalidate = useInvalidateReservations();
  return useMutation<
    z.infer<typeof adminRescheduleResultSchema>,
    Error,
    z.input<typeof adminRescheduleSchema>
  >({
    mutationFn: (input) => api.post(`/api/admin/bookings/${id}/reschedule`, input),
    onSuccess: invalidate,
  });
}

export function useAdminCancellationPreview(id: string, enabled = true) {
  return useQuery<z.infer<typeof adminCancellationPreviewSchema>>({
    queryKey: reservationKeys.cancellationPreview(id),
    enabled,
    queryFn: () => api.get(`/api/admin/bookings/${id}/cancellation-preview`),
  });
}

export function useAdminCancel(id: string) {
  const invalidate = useInvalidateReservations();
  return useMutation<BookingDetail, Error, z.input<typeof adminCancelSchema>>({
    mutationFn: (input) => api.post(`/api/admin/bookings/${id}/cancel`, input),
    onSuccess: invalidate,
  });
}
