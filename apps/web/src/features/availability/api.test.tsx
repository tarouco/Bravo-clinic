import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http } from 'msw';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { createQueryClient } from '../../lib/query-client';
import { availabilityDay } from '../../test/fixtures/nucleo';
import { apiError } from '../../test/msw/handlers';
import { server } from '../../test/msw/server';
import { useDayAvailability, useMonthAvailability } from './api';

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={createQueryClient()}>{children}</QueryClientProvider>;
}

describe('availability hooks', () => {
  it('useDayAvailability returns the MSW fixture of the room and day', async () => {
    const { result } = renderHook(() => useDayAvailability('principal', '2026-10-27'), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(availabilityDay);
  });

  it('useMonthAvailability returns the month grid with the Finados holiday', async () => {
    const { result } = renderHook(() => useMonthAvailability('principal', '2026-11'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.month).toBe('2026-11');
    expect(result.current.data?.days.find((d) => d.date === '2026-11-02')).toMatchObject({
      isHoliday: true,
      holidayName: 'Finados',
    });
  });

  it('does not request until the room and date are known', () => {
    const { result } = renderHook(() => useDayAvailability('principal', undefined), { wrapper });

    expect(result.current.fetchStatus).toBe('idle');
  });

  it('surfaces the API error envelope as an ApiError', async () => {
    server.use(
      http.get('*/api/public/rooms/:slug/availability', () =>
        apiError(429, 'TOO_MANY_ATTEMPTS', 'Muitas tentativas.'),
      ),
    );

    const { result } = renderHook(() => useDayAvailability('principal', '2026-10-27'), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({ status: 429, code: 'TOO_MANY_ATTEMPTS' });
  });
});
