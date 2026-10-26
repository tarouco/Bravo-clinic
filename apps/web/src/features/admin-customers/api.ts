import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type { CustomerProfileInput } from '@bravo/core';
import { api } from '../../lib/api';
import { withQuery } from '../../lib/query-string';
import type { CustomerBookingsPage, CustomerDetail, CustomerList } from './contracts';

// Gestao Clientes data layer: TanStack Query keys `['admin', 'customers', ...]`.

export const customerKeys = {
  all: ['admin', 'customers'] as const,
  list: (q: string) => ['admin', 'customers', 'list', q] as const,
  detail: (id: string) => ['admin', 'customers', 'detail', id] as const,
};

/** `GET /api/admin/customers?q&cursor`, 50 per page (GES-99). */
export function useCustomers(q: string) {
  return useInfiniteQuery<
    CustomerList,
    Error,
    { pages: CustomerList[] },
    readonly unknown[],
    string | null
  >({
    queryKey: customerKeys.list(q),
    // Keep the previous results on screen while a changed search loads.
    placeholderData: keepPreviousData,
    initialPageParam: null,
    getNextPageParam: (last) => last.nextCursor,
    queryFn: ({ pageParam }) =>
      api.get<CustomerList>(withQuery('/api/admin/customers', { q, cursor: pageParam })),
  });
}

/** `GET /api/admin/customers/:id` (GES-100). */
export function useCustomer(id: string) {
  return useQuery<CustomerDetail>({
    queryKey: customerKeys.detail(id),
    queryFn: () => api.get(`/api/admin/customers/${id}`),
  });
}

/** `GET /api/admin/customers/:id/bookings?cursor`: the pages after the one in the detail. */
export function fetchCustomerBookings(id: string, cursor: string): Promise<CustomerBookingsPage> {
  return api.get(withQuery(`/api/admin/customers/${id}/bookings`, { cursor }));
}

/** `PATCH .../notes` (GES-101): admin and reception. */
export function useSaveCustomerNotes(id: string) {
  const queryClient = useQueryClient();
  return useMutation<unknown, Error, string>({
    mutationFn: (notes) => api.patch(`/api/admin/customers/${id}/notes`, { notes }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: customerKeys.detail(id) }),
  });
}

/** `PATCH /api/admin/customers/:id` (GES-102): admin only. */
export function useUpdateCustomer(id: string) {
  const queryClient = useQueryClient();
  return useMutation<unknown, Error, CustomerProfileInput>({
    mutationFn: (input) => api.patch(`/api/admin/customers/${id}`, input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: customerKeys.all }),
  });
}

/** `POST .../anonymize` with a justification of 5..500 characters (GES-127): admin only. */
export function useAnonymizeCustomer(id: string) {
  const queryClient = useQueryClient();
  return useMutation<unknown, Error, string>({
    mutationFn: (justification) =>
      api.post(`/api/admin/customers/${id}/anonymize`, { justification }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: customerKeys.all }),
  });
}
