import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ExtraServiceInput, QuoteStatusUpdate } from '@bravo/core';
import { api } from '../../lib/api';
import { withQuery } from '../../lib/query-string';
import type { ExtraService, QuoteRequest, QuoteRequestPage } from './contracts';

// Gestao extras data layer: TanStack Query keys `['admin', 'extras', ...]`.

export const extrasKeys = {
  all: ['admin', 'extras'] as const,
  services: ['admin', 'extras', 'services'] as const,
  quotes: ['admin', 'extras', 'quotes'] as const,
};

/** `GET /api/admin/extra-services`: every service, inactive ones included (GES-84). */
export function useExtraServices() {
  return useQuery<{ items: ExtraService[] }>({
    queryKey: extrasKeys.services,
    queryFn: () => api.get('/api/admin/extra-services'),
  });
}

export function useCreateExtraService() {
  const queryClient = useQueryClient();
  return useMutation<ExtraService, Error, ExtraServiceInput>({
    mutationFn: (input) => api.post('/api/admin/extra-services', input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: extrasKeys.services }),
  });
}

export function useUpdateExtraService(id: string) {
  const queryClient = useQueryClient();
  return useMutation<ExtraService, Error, ExtraServiceInput>({
    mutationFn: (input) => api.patch(`/api/admin/extra-services/${id}`, input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: extrasKeys.services }),
  });
}

/** `GET /api/admin/quote-requests`, newest first, all statuses (the funnel groups them; GES-96). */
export function useQuoteRequests() {
  return useInfiniteQuery<
    QuoteRequestPage,
    Error,
    { pages: QuoteRequestPage[] },
    readonly unknown[],
    string | null
  >({
    queryKey: extrasKeys.quotes,
    initialPageParam: null,
    getNextPageParam: (last) => last.nextCursor,
    queryFn: ({ pageParam }) =>
      api.get<QuoteRequestPage>(withQuery('/api/admin/quote-requests', { cursor: pageParam })),
  });
}

/** `PATCH /api/admin/quote-requests/:id` with a status move and/or the staff notes (GES-95). */
export function useUpdateQuoteRequest() {
  const queryClient = useQueryClient();
  return useMutation<QuoteRequest, Error, { id: string; body: QuoteStatusUpdate }>({
    mutationFn: ({ id, body }) => api.patch(`/api/admin/quote-requests/${id}`, body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: extrasKeys.quotes }),
    // A move that lost the race (409) leaves the board stale: reload it either way.
    onError: () => void queryClient.invalidateQueries({ queryKey: extrasKeys.quotes }),
  });
}
