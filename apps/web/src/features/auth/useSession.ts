import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import { SESSION_KEY } from '../../lib/query-client';

/** Payload of `GET /api/app/me` (spec FND-57). */
export interface Session {
  id: string;
  name: string;
  email: string;
  role: 'tenant' | 'reception' | 'admin';
  emailVerified: boolean;
  docType: 'cpf' | 'cnpj' | null;
  mfa: { enrolled: boolean; verified: boolean };
}

const FIVE_MINUTES_MS = 5 * 60 * 1000;

/** The signed-in user, or `null` when anonymous (a 401 from the API is not an error here). */
export function useSession(): { session: Session | null; isLoading: boolean } {
  const query = useQuery<Session | null>({
    queryKey: SESSION_KEY,
    staleTime: FIVE_MINUTES_MS,
    queryFn: async () => {
      try {
        return await api.get<Session>('/api/app/me');
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
  });
  return { session: query.data ?? null, isLoading: query.isLoading };
}
