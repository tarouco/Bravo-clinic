import type { DeletionConfirmInput } from '@bravo/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { SESSION_KEY } from '../../lib/query-client';
import type { ConsentList } from './contracts';

export const DATA_EXPORT_URL = '/api/app/me/data-export';

/** `GET /api/app/me/consents`: what the user accepted, with version and date (GES-128). */
export function useConsents() {
  return useQuery<ConsentList>({
    queryKey: ['app', 'consents'],
    queryFn: () => api.get('/api/app/me/consents'),
  });
}

/**
 * `POST /api/app/me/deletion` (GES-124): anonymizes the account. The API ends every session and
 * clears the cookie, so the cached session is dropped on success.
 */
export function useDeleteAccount() {
  const queryClient = useQueryClient();
  return useMutation<unknown, Error, DeletionConfirmInput>({
    mutationFn: (input) => api.post('/api/app/me/deletion', input),
    onSuccess: () => {
      queryClient.setQueryData(SESSION_KEY, null);
    },
  });
}
