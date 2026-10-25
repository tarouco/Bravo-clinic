import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '../../lib/query-client';
import { useClinicConfig } from './useClinicConfig';

function wrapperFor() {
  const client = createQueryClient();
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useClinicConfig', () => {
  it('returns the fallback while loading', () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => undefined)));

    const { result } = renderHook(() => useClinicConfig(), { wrapper: wrapperFor() });

    expect(result.current).toEqual({ googleEnabled: false, whatsappE164: '' });
  });

  it('returns the fallback when the request fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'x' } }), {
        status: 404,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useClinicConfig(), { wrapper: wrapperFor() });

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(result.current).toEqual({ googleEnabled: false, whatsappE164: '' });
  });

  it('returns the API config once loaded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            googleEnabled: true,
            whatsappE164: '+5547999990000',
            environment: 'production',
          }),
          { status: 200 },
        ),
      ),
    );

    const { result } = renderHook(() => useClinicConfig(), { wrapper: wrapperFor() });

    await waitFor(() => expect(result.current.whatsappE164).toBe('+5547999990000'));
    expect(result.current.googleEnabled).toBe(true);
  });
});
