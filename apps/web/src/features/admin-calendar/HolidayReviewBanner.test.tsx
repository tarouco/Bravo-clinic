import type { LocalDate } from '@bravo/core';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { holiday } from '../../test/fixtures/nucleo';
import { server } from '../../test/msw/server';
import { renderWithProviders } from '../../test/render-with-providers';
import { HolidayReviewBanner } from './HolidayReviewBanner';

const OCTOBER_FIRST = '2026-10-01' as LocalDate;

/** Answers the 2027 holiday list with `items`; other years keep the default fixture. */
function nextYearHolidays(items: (typeof holiday)[]) {
  server.use(
    http.get('*/api/admin/calendar/holidays', ({ request }) =>
      HttpResponse.json({
        items: new URL(request.url).searchParams.get('year') === '2027' ? items : [holiday],
      }),
    ),
  );
}

function renderBanner(today: LocalDate = OCTOBER_FIRST, onViewList = vi.fn()) {
  renderWithProviders(<HolidayReviewBanner today={today} onViewList={onViewList} />);
  return onViewList;
}

describe('HolidayReviewBanner (NUC-53)', () => {
  it('asks to review next year on 1 October when a 2027 holiday needs review', async () => {
    nextYearHolidays([{ ...holiday, date: '2027-11-02', needsReview: true }]);
    renderBanner();

    expect(await screen.findByText('Confira os feriados de 2027')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Importar nacionais' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ver lista' })).toBeInTheDocument();
  });

  it('is shown when next year has no holiday rows yet', async () => {
    nextYearHolidays([]);
    renderBanner();

    expect(await screen.findByText('Confira os feriados de 2027')).toBeInTheDocument();
  });

  it('stays hidden before October and when next year is already reviewed', async () => {
    nextYearHolidays([]);
    const { unmount } = renderWithProviders(
      <HolidayReviewBanner today={'2026-09-30'} onViewList={vi.fn()} />,
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(screen.queryByText(/Confira os feriados/)).toBeNull();
    unmount();

    nextYearHolidays([{ ...holiday, date: '2027-11-02', needsReview: false }]);
    renderBanner();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(screen.queryByText(/Confira os feriados/)).toBeNull();
  });

  it('imports the national holidays of next year and opens the list on demand', async () => {
    nextYearHolidays([]);
    const years: unknown[] = [];
    server.use(
      http.post('*/api/admin/calendar/holidays/import', async ({ request }) => {
        years.push(await request.json());
        return HttpResponse.json({ inserted: 9, updated: 0 });
      }),
    );
    const onViewList = renderBanner();

    await userEvent.click(await screen.findByRole('button', { name: 'Importar nacionais' }));
    await waitFor(() => expect(years).toEqual([{ year: 2027 }]));

    await userEvent.click(screen.getByRole('button', { name: 'Ver lista' }));
    expect(onViewList).toHaveBeenCalledWith(2027);
  });
});
