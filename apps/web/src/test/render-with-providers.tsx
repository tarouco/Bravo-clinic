import { QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { createQueryClient } from '../lib/query-client';
import { ThemeProvider } from '../theme/ThemeProvider';

/**
 * Stubs `fetch` so `GET /api/public/config` answers with the given WhatsApp number and every
 * other endpoint answers 404 (`null` simulates an unreachable API; the config then falls back to
 * an empty number).
 * Remember to call `vi.unstubAllGlobals()` in `afterEach`.
 */
export function stubClinicConfig(whatsappE164: string | null): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((input: RequestInfo | URL) => {
      if (whatsappE164 === null) return Promise.reject(new TypeError('network down'));
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      // Any other endpoint is unavailable, so pages fall back to their static content.
      if (!url.includes('/api/public/config')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Não encontrado.' } }),
            { status: 404, headers: { 'Content-Type': 'application/json' } },
          ),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ googleEnabled: false, whatsappE164, environment: 'test' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }),
  );
}

/** Renders `ui` with theme, TanStack Query and a memory router, as the public pages run. */
export function renderWithProviders(ui: ReactElement, route = '/'): RenderResult {
  return render(
    <ThemeProvider>
      <QueryClientProvider client={createQueryClient()}>
        <MemoryRouter
          initialEntries={[route]}
          future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        >
          {ui}
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}
