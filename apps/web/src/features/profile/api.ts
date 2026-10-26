import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Me, UpdateMeInput } from '@bravo/core';
import { api } from '../../lib/api';
import { SESSION_KEY } from '../../lib/query-client';

export const PROFILE_KEY = ['app', 'me'] as const;

/** `GET /api/app/me` with the profile fields núcleo edits (phone, profession, registry, document). */
export function useProfile() {
  return useQuery<Me>({
    queryKey: PROFILE_KEY,
    queryFn: () => api.get<Me>('/api/app/me'),
  });
}

/** `PATCH /api/app/me`: name, phone, profession, registry and the one-time document. */
export function useUpdateMe() {
  const queryClient = useQueryClient();
  return useMutation<Me, Error, UpdateMeInput>({
    mutationFn: (input) => api.patch<Me>('/api/app/me', input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: SESSION_KEY });
      await queryClient.invalidateQueries({ queryKey: PROFILE_KEY });
    },
  });
}
