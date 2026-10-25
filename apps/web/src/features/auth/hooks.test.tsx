import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient, SESSION_KEY } from '../../lib/query-client';
import { safeNextPath, useLogin, useLogout, useTotpVerify } from './hooks';
import type { Session } from './useSession';

const tenant: Session = {
  id: 'u1',
  name: 'Ana Souza',
  email: 'ana@example.com',
  role: 'tenant',
  emailVerified: true,
  docType: 'cpf',
  mfa: { enrolled: false, verified: false },
};

function setup() {
  const client: QueryClient = createQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

function stubFetch(status: number, body?: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('safeNextPath', () => {
  it('keeps an in-site path', () => {
    expect(safeNextPath('/app/agenda')).toBe('/app/agenda');
  });

  it.each(['//evil.com', 'https://evil.com', 'javascript:alert(1)', 'app', '/\\evil.com'])(
    'rejects %s',
    (value) => {
      expect(safeNextPath(value)).toBeNull();
    },
  );

  it('returns null when there is no value', () => {
    expect(safeNextPath(null)).toBeNull();
  });
});

describe('useLogin', () => {
  it('posts the credentials to /api/public/auth/login and stores the user as the session', async () => {
    const fetchMock = stubFetch(200, { user: tenant, mfaRequired: false });
    const { client, wrapper } = setup();
    const { result } = renderHook(() => useLogin(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ email: 'ana@example.com', password: 'Senha1234' });
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/public/auth/login');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ email: 'ana@example.com', password: 'Senha1234' }));
    expect(client.getQueryData(SESSION_KEY)).toEqual(tenant);
  });
});

describe('useLogout', () => {
  it('posts to /api/app/auth/logout and sets the session to null', async () => {
    const fetchMock = stubFetch(204);
    const { client, wrapper } = setup();
    client.setQueryData(SESSION_KEY, tenant);
    const { result } = renderHook(() => useLogout(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync();
    });

    expect((fetchMock.mock.calls[0] as [string])[0]).toBe('/api/app/auth/logout');
    expect(client.getQueryData(SESSION_KEY)).toBeNull();
  });
});

describe('useTotpVerify', () => {
  it('posts the code and marks the cached staff session as MFA verified', async () => {
    const fetchMock = stubFetch(200, { ok: true });
    const { client, wrapper } = setup();
    client.setQueryData(SESSION_KEY, { ...tenant, role: 'admin' });
    const { result } = renderHook(() => useTotpVerify(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ code: '123456' });
    });

    await waitFor(() =>
      expect(client.getQueryData<Session>(SESSION_KEY)?.mfa).toEqual({
        enrolled: true,
        verified: true,
      }),
    );
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/app/auth/totp/verify');
    expect(init.body).toBe(JSON.stringify({ code: '123456' }));
  });
});
