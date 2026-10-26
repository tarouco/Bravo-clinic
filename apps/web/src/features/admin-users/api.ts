import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { RoleChangeInput, StaffUserInput } from '@bravo/core';
import { api } from '../../lib/api';
import type { StaffUser, StaffUserList } from './contracts';

// Gestao Usuários data layer: one TanStack Query key, `['admin', 'users']`.

export const userKeys = { all: ['admin', 'users'] as const };

/** `GET /api/admin/users` (GES-110). */
export function useStaffUsers() {
  return useQuery<StaffUserList>({
    queryKey: userKeys.all,
    queryFn: () => api.get('/api/admin/users'),
  });
}

/** `POST /api/admin/users`: invites a new e-mail or promotes a customer (GES-111). */
export function useInviteStaff() {
  const queryClient = useQueryClient();
  return useMutation<StaffUser, Error, StaffUserInput>({
    mutationFn: (input) => api.post('/api/admin/users', input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: userKeys.all }),
  });
}

/** `PATCH /api/admin/users/:id` with a role and/or status change (GES-112, GES-113). */
export function useUpdateStaffUser() {
  const queryClient = useQueryClient();
  return useMutation<StaffUser, Error, { id: string; body: RoleChangeInput }>({
    mutationFn: ({ id, body }) => api.patch(`/api/admin/users/${id}`, body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: userKeys.all }),
  });
}

/** `POST /api/admin/users/:id/totp-reset` with a justification of 5..500 characters (GES-114). */
export function useResetTotp() {
  const queryClient = useQueryClient();
  return useMutation<unknown, Error, { id: string; justification: string }>({
    mutationFn: ({ id, justification }) =>
      api.post(`/api/admin/users/${id}/totp-reset`, { justification }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: userKeys.all }),
  });
}
