import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { ApiError } from './api';

export const SESSION_KEY = ['session'] as const;

/** Failed requests are retried once, except client errors (4xx), which a retry cannot fix. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 1;
}

export function createQueryClient(): QueryClient {
  // A 401 from any request means the session is gone: reset it so the UI falls back to anonymous.
  const resetSessionOn401 = (error: unknown) => {
    if (error instanceof ApiError && error.status === 401) {
      client.setQueryData(SESSION_KEY, null);
    }
  };

  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError: resetSessionOn401 }),
    mutationCache: new MutationCache({ onError: resetSessionOn401 }),
    defaultOptions: {
      queries: { retry: shouldRetry, refetchOnWindowFocus: false },
    },
  });
  return client;
}

export const queryClient = createQueryClient();
