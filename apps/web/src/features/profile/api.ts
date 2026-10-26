import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Me, UpdateMeInput } from '@bravo/core';
import { api } from '../../lib/api';
import { SESSION_KEY } from '../../lib/query-client';

/** `PATCH /api/app/me`: name, phone, profession, registry and the one-time document. */
export function useUpdateMe() {
  const queryClient = useQueryClient();
  return useMutation<Me, Error, UpdateMeInput>({
    mutationFn: (input) => api.patch<Me>('/api/app/me', input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SESSION_KEY }),
  });
}
