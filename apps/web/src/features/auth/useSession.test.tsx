import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '../../lib/query-client';
import { useSession, type Session } from './useSession';

const user: Session = {
  id: 'u1',
  name: 'Ana Souza',
  email: 'ana@example.com',
  role: 'tenant',
  emailVerified: true,
  docType: 'cpf',
  mfa: { enrolled: false, verified: false },
};

function wrapperFor() {
  const client = createQueryClient();
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useSession', () => {
  it('returns null once /api/app/me answers 401', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'Não autenticado' } }),
          { status: 401 },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useSession(), { wrapper: wrapperFor() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.session).toBeNull();
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe('/api/app/me');
  });

  it('returns the user when /api/app/me answers 200', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(user), { status: 200 })),
    );

    const { result } = renderHook(() => useSession(), { wrapper: wrapperFor() });

    await waitFor(() => expect(result.current.session).toEqual(user));
    expect(result.current.isLoading).toBe(false);
  });
});
