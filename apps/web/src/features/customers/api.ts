import { useMutation, useQuery } from '@tanstack/react-query';
import type { z } from 'zod';
import type {
  CustomerCreateInput,
  customerCreatedSchema,
  customerSearchResultSchema,
} from '@bravo/core';
import { api } from '../../lib/api';
import { withQuery } from '../../lib/query-string';

const MIN_QUERY_LENGTH = 2;

/** Counter customer search; runs from 2 characters (the API rejects shorter terms). */
export function useCustomerSearch(term: string) {
  const q = term.trim();
  return useQuery<z.infer<typeof customerSearchResultSchema>>({
    queryKey: ['admin', 'customers', 'search', q],
    enabled: q.length >= MIN_QUERY_LENGTH,
    staleTime: 30 * 1000,
    queryFn: () => api.get(withQuery('/api/admin/customers/search', { q })),
  });
}

export function useCreateCustomer() {
  return useMutation<z.infer<typeof customerCreatedSchema>, Error, CustomerCreateInput>({
    mutationFn: (input) => api.post('/api/admin/customers', input),
  });
}
