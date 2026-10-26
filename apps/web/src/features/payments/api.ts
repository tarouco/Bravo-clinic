import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PaymentConfig, SandboxCharge, SaveCardInput, SavedCard } from '@bravo/core';
import { api } from '../../lib/api';
import { bookingKeys } from '../booking/api';

export const paymentKeys = {
  config: ['public', 'payment-config'] as const,
  sandboxCharge: (id: string) => ['public', 'sandbox-charge', id] as const,
  cards: ['app', 'cards'] as const,
};

export function usePaymentConfig() {
  return useQuery<PaymentConfig>({
    queryKey: paymentKeys.config,
    staleTime: 5 * 60 * 1000,
    queryFn: () => api.get<PaymentConfig>('/api/public/payment-config'),
  });
}

export function useSandboxCharge(chargeId: string | undefined) {
  return useQuery<SandboxCharge>({
    queryKey: paymentKeys.sandboxCharge(chargeId ?? ''),
    enabled: chargeId !== undefined && chargeId !== '',
    queryFn: () => api.get<SandboxCharge>(`/api/public/sandbox/charges/${chargeId ?? ''}`),
  });
}

/** "Aprovar pagamento" / "Recusar pagamento" on the sandbox hosted checkout. */
export function useSandboxAction(chargeId: string) {
  const queryClient = useQueryClient();
  return useMutation<{ status: string }, Error, 'approve' | 'reject'>({
    mutationFn: (action) =>
      api.post<{ status: string }>(`/api/public/sandbox/charges/${chargeId}/${action}`, {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: paymentKeys.sandboxCharge(chargeId) });
      void queryClient.invalidateQueries({ queryKey: bookingKeys.all });
    },
  });
}

export function useCards() {
  return useQuery<{ items: SavedCard[] }>({
    queryKey: paymentKeys.cards,
    queryFn: () => api.get<{ items: SavedCard[] }>('/api/app/cards'),
  });
}

export function useSaveCard() {
  const queryClient = useQueryClient();
  return useMutation<SavedCard, Error, SaveCardInput>({
    mutationFn: (input) => api.post<SavedCard>('/api/app/cards', input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: paymentKeys.cards }),
  });
}

export function useDeleteCard() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => api.delete<void>(`/api/app/cards/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: paymentKeys.cards }),
  });
}
