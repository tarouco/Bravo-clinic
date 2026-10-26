import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { GatewayCredentialsInput } from '@bravo/core';
import { api } from '../../lib/api';
import type { GatewayAdapter, GatewayOverview, GatewayTestResult } from './contracts';

// Gestao Integrações data layer: TanStack Query keys `['admin', 'integrations', ...]`, one hook
// per endpoint. Every write invalidates the whole tree so the tabs follow each other.

export const integrationKeys = {
  all: ['admin', 'integrations'] as const,
  gateway: ['admin', 'integrations', 'gateway'] as const,
};

const gatewayPath = (provider: string): string => `/api/admin/integrations/gateway/${provider}`;

/** `GET /api/admin/integrations/gateway` (GES-35). */
export function useGateway() {
  return useQuery<GatewayOverview>({
    queryKey: integrationKeys.gateway,
    queryFn: () => api.get('/api/admin/integrations/gateway'),
  });
}

/** `PUT .../gateway/:provider`; an empty secret keeps the stored one (GES-36). */
export function useSaveGateway(provider: string) {
  const queryClient = useQueryClient();
  return useMutation<GatewayAdapter, Error, GatewayCredentialsInput>({
    mutationFn: (input) => api.put(gatewayPath(provider), input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: integrationKeys.all }),
  });
}

/** `POST .../gateway/:provider/test`; a rejected credential is a 200 with `ok: false` (GES-37). */
export function useTestGateway(provider: string) {
  return useMutation<GatewayTestResult, Error, void>({
    mutationFn: () => api.post(`${gatewayPath(provider)}/test`),
  });
}

/** `POST .../gateway/:provider/activate` (GES-38). */
export function useActivateGateway(provider: string) {
  const queryClient = useQueryClient();
  return useMutation<unknown, Error, void>({
    mutationFn: () => api.post(`${gatewayPath(provider)}/activate`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: integrationKeys.all }),
  });
}
