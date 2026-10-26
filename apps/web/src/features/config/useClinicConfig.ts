import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';

export interface ClinicConfig {
  googleEnabled: boolean;
  whatsappE164: string;
  /** Public contact e-mail; shown in the footer only when the API provides one. */
  contactEmail?: string;
  /** VAPID public key for web push (GES-75); null when push is not configured. */
  vapidPublicKey?: string | null;
}

/** Used while loading and when the request fails, so public pages never block on the API. */
export const CLINIC_CONFIG_FALLBACK: ClinicConfig = { googleEnabled: false, whatsappE164: '' };

const FIVE_MINUTES_MS = 5 * 60 * 1000;

/** The config query itself, for callers that must tell "still loading" from "not provided". */
export function useClinicConfigQuery() {
  return useQuery<ClinicConfig>({
    queryKey: ['public', 'config'],
    staleTime: FIVE_MINUTES_MS,
    queryFn: () => api.get<ClinicConfig>('/api/public/config'),
  });
}

export function useClinicConfig(): ClinicConfig {
  const { data } = useClinicConfigQuery();
  return data ?? CLINIC_CONFIG_FALLBACK;
}
