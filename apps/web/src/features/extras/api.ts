import type { QuoteRequestInput } from '@bravo/core';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { withQuery } from '../../lib/query-string';
import type { OwnQuoteRequestPage, PublicExtraServiceList } from './contracts';

// Public and tenant extras data layer.

export const extrasKeys = {
  services: ['public', 'extra-services'] as const,
  myQuotes: ['app', 'quote-requests'] as const,
};

const FIVE_MINUTES_MS = 5 * 60 * 1000;

/** `GET /api/public/extra-services`: active services in display order (GES-86). */
export function usePublicExtraServices() {
  return useQuery<PublicExtraServiceList>({
    queryKey: extrasKeys.services,
    staleTime: FIVE_MINUTES_MS,
    queryFn: () => api.get('/api/public/extra-services'),
  });
}

/** `POST /api/public/quote-requests` (GES-90); a session, when present, links the request. */
export function useSubmitQuoteRequest() {
  const queryClient = useQueryClient();
  return useMutation<unknown, Error, QuoteRequestInput>({
    mutationFn: (input) => api.post('/api/public/quote-requests', input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: extrasKeys.myQuotes }),
  });
}

/** `GET /api/app/quote-requests`: the signed-in tenant's own requests, newest first (GES-97). */
export function useMyQuoteRequests() {
  return useInfiniteQuery<
    OwnQuoteRequestPage,
    Error,
    { pages: OwnQuoteRequestPage[] },
    readonly unknown[],
    string | null
  >({
    queryKey: extrasKeys.myQuotes,
    initialPageParam: null,
    getNextPageParam: (last) => last.nextCursor,
    queryFn: ({ pageParam }) =>
      api.get<OwnQuoteRequestPage>(withQuery('/api/app/quote-requests', { cursor: pageParam })),
  });
}
