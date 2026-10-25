import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PolicySettings, PolicyValues } from '@bravo/core';
import { api } from '../../lib/api';
import { catalogKeys } from '../catalog/api';

export const policySettingsKey = ['admin', 'settings', 'policies'] as const;

/** Policy values editable in Gestão de Reservas → Políticas (admin only). */
export function usePolicySettings() {
  return useQuery<PolicySettings>({
    queryKey: policySettingsKey,
    queryFn: () => api.get<PolicySettings>('/api/admin/settings/policies'),
  });
}

export function useUpdatePolicySettings() {
  const queryClient = useQueryClient();
  return useMutation<PolicySettings, Error, PolicyValues>({
    mutationFn: (values) => api.put<PolicySettings>('/api/admin/settings/policies', values),
    onSuccess: (result) => {
      queryClient.setQueryData(policySettingsKey, result);
      void queryClient.invalidateQueries({ queryKey: catalogKeys.policies });
    },
  });
}
