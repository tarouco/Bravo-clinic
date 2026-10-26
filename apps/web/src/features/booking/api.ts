import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type {
  AvailabilityDay,
  BookingDetail,
  BookingList,
  CancellationPreview,
  ChargeIntent,
  CreateBookingInput,
  PayBalanceRequest,
  PayRequest,
  PreReservationPublic,
  Quote,
  QuoteRequest,
  RescheduleQuote,
  RescheduleQuoteRequest,
  RescheduleRequest,
  RescheduleResult,
} from '@bravo/core';
import { api } from '../../lib/api';
import { newIdempotencyKey, withQuery } from '../../lib/query-string';
import { availabilityKeys } from '../availability/api';

export type BookingTab = 'upcoming' | 'past' | 'cancelled';

export const bookingKeys = {
  all: ['app', 'bookings'] as const,
  list: (tab: BookingTab) => ['app', 'bookings', tab] as const,
  detail: (id: string) => ['app', 'booking', id] as const,
  quote: (request: QuoteRequest | null) => ['public', 'quote', request] as const,
  rescheduleQuote: (id: string, request: RescheduleQuoteRequest | null) =>
    ['app', 'reschedule-quote', id, request] as const,
  cancellationPreview: (id: string) => ['app', 'cancellation-preview', id] as const,
  preReservation: (token: string) => ['public', 'pre-reservation', token] as const,
};

/** Variables of a money-moving mutation: the body plus an optional `Idempotency-Key`. */
export interface IdempotentVariables<T> {
  body: T;
  /** Reuse the key only to retry the same attempt; omitted, a new key is generated. */
  idempotencyKey?: string;
}

const keyOf = (v: { idempotencyKey?: string }): string => v.idempotencyKey ?? newIdempotencyKey();

/** Price preview of an interval; the request is `null` until the selection is complete. */
export function useQuote(request: QuoteRequest | null) {
  return useQuery<Quote>({
    queryKey: bookingKeys.quote(request),
    enabled: request !== null,
    staleTime: 15 * 1000,
    placeholderData: keepPreviousData,
    queryFn: () => api.post<Quote>('/api/public/bookings/quote', request),
  });
}

export function usePreReservation(token: string | undefined) {
  return useQuery<PreReservationPublic>({
    queryKey: bookingKeys.preReservation(token ?? ''),
    enabled: token !== undefined && token !== '',
    queryFn: () =>
      api.get<PreReservationPublic>(
        `/api/public/pre-reservations/${encodeURIComponent(token ?? '')}`,
      ),
  });
}

export function useCreateBooking() {
  const queryClient = useQueryClient();
  return useMutation<BookingDetail, Error, IdempotentVariables<CreateBookingInput>>({
    mutationFn: (v) =>
      api.post<BookingDetail>('/api/app/bookings', v.body, { idempotencyKey: keyOf(v) }),
    onSuccess: (booking) => {
      queryClient.setQueryData(bookingKeys.detail(booking.id), booking);
      void queryClient.invalidateQueries({ queryKey: bookingKeys.all });
      void queryClient.invalidateQueries({ queryKey: availabilityKeys.all });
    },
  });
}

/** Pix, card or saved-card charge for the booking deposit (or full amount). */
export function usePay(bookingId: string) {
  return useMutation<ChargeIntent, Error, IdempotentVariables<PayRequest>>({
    mutationFn: (v) =>
      api.post<ChargeIntent>(`/api/app/bookings/${bookingId}/pay`, v.body, {
        idempotencyKey: keyOf(v),
      }),
  });
}

export function usePayBalance(bookingId: string) {
  return useMutation<ChargeIntent, Error, IdempotentVariables<PayBalanceRequest>>({
    mutationFn: (v) =>
      api.post<ChargeIntent>(`/api/app/bookings/${bookingId}/pay-balance`, v.body, {
        idempotencyKey: keyOf(v),
      }),
  });
}

/** Cursor-paginated bookings of one tab. */
export function useMyBookings(tab: BookingTab) {
  return useInfiniteQuery<
    BookingList,
    Error,
    { pages: BookingList[] },
    readonly unknown[],
    string | null
  >({
    queryKey: bookingKeys.list(tab),
    initialPageParam: null,
    getNextPageParam: (last) => last.nextCursor,
    queryFn: ({ pageParam }) =>
      api.get<BookingList>(withQuery('/api/app/bookings', { tab, cursor: pageParam })),
  });
}

/** One booking; `poll` refetches every 2 s while the checkout waits for the payment webhook. */
export function useBooking(id: string | undefined, options: { poll?: boolean } = {}) {
  return useQuery<BookingDetail>({
    queryKey: bookingKeys.detail(id ?? ''),
    enabled: id !== undefined && id !== '',
    refetchInterval: options.poll ? 2000 : false,
    queryFn: () => api.get<BookingDetail>(`/api/app/bookings/${id ?? ''}`),
  });
}

/**
 * Day grid for the reschedule modal: the booking's room without the booking's own occupancy, so a
 * slot overlapping the current one can be chosen (NUC-142).
 */
export function useRescheduleDayAvailability(bookingId: string, date: string | undefined) {
  return useQuery<AvailabilityDay>({
    queryKey: [...bookingKeys.detail(bookingId), 'reschedule-day', date ?? ''] as const,
    enabled: Boolean(date),
    staleTime: 15 * 1000,
    queryFn: () =>
      api.get<AvailabilityDay>(
        withQuery(`/api/app/bookings/${bookingId}/reschedule/availability`, { date }),
      ),
  });
}

export function useRescheduleQuote(bookingId: string, request: RescheduleQuoteRequest | null) {
  return useQuery<RescheduleQuote>({
    queryKey: bookingKeys.rescheduleQuote(bookingId, request),
    enabled: request !== null,
    queryFn: () =>
      api.post<RescheduleQuote>(`/api/app/bookings/${bookingId}/reschedule/quote`, request),
  });
}

/** 200 moves the booking at once; 202 returns the charge for the price difference. */
export function useReschedule(bookingId: string) {
  const queryClient = useQueryClient();
  return useMutation<RescheduleResult, Error, IdempotentVariables<RescheduleRequest>>({
    mutationFn: (v) =>
      api.post<RescheduleResult>(`/api/app/bookings/${bookingId}/reschedule`, v.body, {
        idempotencyKey: keyOf(v),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: bookingKeys.detail(bookingId) });
      void queryClient.invalidateQueries({ queryKey: bookingKeys.all });
      void queryClient.invalidateQueries({ queryKey: availabilityKeys.all });
    },
  });
}

export function useCancellationPreview(bookingId: string, enabled = true) {
  return useQuery<CancellationPreview>({
    queryKey: bookingKeys.cancellationPreview(bookingId),
    enabled,
    queryFn: () =>
      api.get<CancellationPreview>(`/api/app/bookings/${bookingId}/cancellation-preview`),
  });
}

export function useCancel(bookingId: string) {
  const queryClient = useQueryClient();
  return useMutation<BookingDetail, Error, IdempotentVariables<{ reason?: string }>>({
    mutationFn: (v) =>
      api.post<BookingDetail>(`/api/app/bookings/${bookingId}/cancel`, v.body, {
        idempotencyKey: keyOf(v),
      }),
    onSuccess: (booking) => {
      queryClient.setQueryData(bookingKeys.detail(bookingId), booking);
      void queryClient.invalidateQueries({ queryKey: bookingKeys.all });
      void queryClient.invalidateQueries({ queryKey: availabilityKeys.all });
    },
  });
}
