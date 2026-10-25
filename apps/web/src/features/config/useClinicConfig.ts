import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';

export interface ClinicConfig {
  googleEnabled: boolean;
  whatsappE164: string;
}

/** Used while loading and when the request fails, so public pages never block on the API. */
export const CLINIC_CONFIG_FALLBACK: ClinicConfig = { googleEnabled: false, whatsappE164: '' };

const FIVE_MINUTES_MS = 5 * 60 * 1000;

export function useClinicConfig(): ClinicConfig {
  const { data } = useQuery<ClinicConfig>({
    queryKey: ['public', 'config'],
    staleTime: FIVE_MINUTES_MS,
    queryFn: () => api.get<ClinicConfig>('/api/public/config'),
  });
  return data ?? CLINIC_CONFIG_FALLBACK;
}
