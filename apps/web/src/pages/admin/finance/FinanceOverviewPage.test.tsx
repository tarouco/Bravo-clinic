import { screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildEmptySummary, buildSummary } from '../../../features/admin-finance/fixtures';
import { apiError } from '../../../test/msw/handlers';
import { server } from '../../../test/msw/server';
import { renderWithProviders } from '../../../test/render-with-providers';
import { plain } from '../../../test/session';
import { FinanceOverviewPage } from './FinanceOverviewPage';

const TODAY = '2026-10-26' as const;

function Probe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

const urlParams = () =>
  new URLSearchParams(screen.getByTestId('location').textContent.split('?')[1] ?? '');

/** Stubs the summary route with the fixture for whatever selection the request carries. */
function stubSummary(requests: URL[] = []) {
  server.use(
    http.get('*/api/admin/finance/summary', ({ request }) => {
      const url = new URL(request.url);
      requests.push(url);
      return HttpResponse.json(
        buildSummary({
          from: url.searchParams.get('from') ?? '',
          to: url.searchParams.get('to') ?? '',
          grouping: url.searchParams.get('grouping') as 'week' | 'month' | 'quarter',
          regime: url.searchParams.get('regime') as 'cash' | 'accrual',
        }),
      );
    }),
  );
  return requests;
}

function renderPage(route = '/admin/financeiro') {
  renderWithProviders(
    <>
      <FinanceOverviewPage today={TODAY} />
      <Probe />
    </>,
    route,
  );
}

/** The page has drawn its figures once the chart section exists. */
const ready = () => screen.findByRole('heading', { name: 'Evolução' });

/** The stat tile with this label (the chart legend and table repeat some labels). */
const tile = (label: string) =>
  screen
    .getAllByText(label)
    .find((element) => element.tagName === 'P')
    ?.closest('div') as HTMLElement;

describe('FinanceOverviewPage', () => {
  it('requests Caixa, month and the last 6 months by default', async () => {
    const requests = stubSummary();
    renderPage();

    await ready();

    expect(requests).toHaveLength(1);
    expect(Object.fromEntries(requests[0]?.searchParams ?? [])).toEqual({
      from: '2026-05-01',
      to: '2026-10-26',
      grouping: 'month',
      regime: 'cash',
    });
    expect(screen.getByRole('radio', { name: 'Caixa' })).toBeChecked();
    expect(screen.getByLabelText('Agrupar por')).toHaveValue('month');
    expect(screen.getByLabelText('De')).toHaveValue('2026-05-01');
    expect(screen.getByLabelText('Até')).toHaveValue('2026-10-26');
  });

  it('crosses the year boundary when counting back 6 months', async () => {
    const requests = stubSummary();
    renderWithProviders(<FinanceOverviewPage today="2026-02-10" />);

    await waitFor(() => {
      expect(requests).toHaveLength(1);
    });

    expect(requests[0]?.searchParams.get('from')).toBe('2025-09-01');
  });

  it('shows net revenue, expenses and result with the delta against the previous range', async () => {
    stubSummary();
    renderPage();
    await ready();

    const net = tile('Receita líquida');
    expect(plain(net.textContent)).toContain('R$ 6.430,00');
    expect(net).toHaveTextContent('+28,6%');
    expect(net).toHaveTextContent('vs. 03/11/2025–30/04/2026');

    const expenses = tile('Despesas');
    expect(plain(expenses.textContent)).toContain('R$ 1.100,00');
    // 1.000,00 -> 1.100,00 spent: a rise of 10 % is shown as +10,0 % in the error tone.
    expect(expenses).toHaveTextContent('+10,0%');
    expect(within(expenses).getByText('+10,0%').closest('p')).toHaveClass('text-error');

    const result = tile('Resultado');
    expect(plain(result.textContent)).toContain('R$ 5.330,00');
    expect(result).toHaveTextContent('+33,3%');
  });

  it('draws one chart group per month with an accessible table of the same figures', async () => {
    stubSummary();
    renderPage();
    await ready();

    const table = screen.getByRole('table', {
      name: /Evolução de 01\/05\/2026–26\/10\/2026 por mês/,
    });
    const labels = within(table)
      .getAllByRole('rowheader')
      .map((h) => h.textContent);
    expect(labels).toEqual([
      'mai/2026',
      'jun/2026',
      'jul/2026',
      'ago/2026',
      'set/2026',
      'out/2026',
    ]);
    expect(document.querySelectorAll('[data-bucket]')).toHaveLength(6);
  });

  it('lists the breakdown by revenue and expense category and the comparison table', async () => {
    stubSummary();
    renderPage();
    await ready();

    const revenue = screen.getByRole('table', { name: 'Receita bruta por categoria' });
    expect(within(revenue).getByText('Locação avulsa')).toBeInTheDocument();
    expect(plain(within(revenue).getByText('Locação avulsa').closest('tr')?.textContent)).toContain(
      'R$ 4.100,00',
    );
    expect(within(revenue).queryByText('Serviços extras')).not.toBeInTheDocument();

    const expenses = screen.getByRole('table', { name: 'Despesas por categoria' });
    const rows = within(expenses).getAllByRole('row').slice(1);
    expect(
      rows.map((r) =>
        within(r)
          .getAllByRole('cell')
          .map((c) => plain(c.textContent)),
      ),
    ).toEqual([
      ['Aluguel', 'R$ 800,00'],
      ['Energia elétrica', 'R$ 300,00'],
    ]);

    const summary = screen.getByRole('table', { name: /Resumo do período/ });
    const netRow = within(summary).getByText('5. = Receita líquida').closest('tr') as HTMLElement;
    expect(
      within(netRow)
        .getAllByRole('cell')
        .map((c) => plain(c.textContent)),
    ).toEqual(['5. = Receita líquida', 'R$ 6.430,00', 'R$ 5.000,00', '+28,6%']);
  });

  it('switches to Competência and quarter: URL params, a refetch and the export link follow', async () => {
    const requests = stubSummary();
    renderPage();
    await ready();

    await userEvent.click(screen.getByRole('radio', { name: 'Competência' }));
    await userEvent.selectOptions(screen.getByLabelText('Agrupar por'), 'quarter');

    await waitFor(() => {
      expect(requests.at(-1)?.searchParams.get('regime')).toBe('accrual');
      expect(requests.at(-1)?.searchParams.get('grouping')).toBe('quarter');
    });
    expect(urlParams().get('regime')).toBe('accrual');
    expect(urlParams().get('grouping')).toBe('quarter');
    expect(screen.getByRole('radio', { name: 'Competência' })).toBeChecked();

    const link = screen.getByRole('link', { name: 'Exportar DRE (.xlsx)' });
    const href = new URL(link.getAttribute('href') ?? '', 'http://localhost');
    expect(href.pathname).toBe('/api/admin/finance/dre.xlsx');
    expect(Object.fromEntries(href.searchParams)).toEqual({
      from: '2026-05-01',
      to: '2026-10-26',
      regime: 'accrual',
    });
  });

  it('reads the selection from the URL on load and keeps it in the export link', async () => {
    const requests = stubSummary();
    renderPage('/admin/financeiro?regime=accrual&grouping=week&from=2026-09-01&to=2026-09-30');
    await ready();

    expect(requests[0]?.searchParams.get('grouping')).toBe('week');
    expect(screen.getByLabelText('De')).toHaveValue('2026-09-01');
    expect(screen.getByRole('link', { name: 'Exportar DRE (.xlsx)' })).toHaveAttribute(
      'href',
      '/api/admin/finance/dre.xlsx?from=2026-09-01&to=2026-09-30&regime=accrual',
    );
  });

  it('changes the range from the date fields and refetches', async () => {
    const requests = stubSummary();
    renderPage();
    await ready();

    fireEvent.change(screen.getByLabelText('De'), { target: { value: '2026-08-01' } });

    await waitFor(() => {
      expect(requests.at(-1)?.searchParams.get('from')).toBe('2026-08-01');
    });
    expect(urlParams().get('from')).toBe('2026-08-01');
  });

  it('refuses a range longer than 731 days: field error, no request and a disabled export', async () => {
    const requests = stubSummary();
    renderPage('/admin/financeiro?from=2024-01-01&to=2026-10-26');

    expect(await screen.findByText('O período pode ter no máximo 731 dias')).toBeInTheDocument();
    expect(requests).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Exportar DRE (.xlsx)' })).toBeDisabled();
  });

  it('refuses an end date before the start date', async () => {
    const requests = stubSummary();
    renderPage('/admin/financeiro?from=2026-10-26&to=2026-10-01');

    expect(
      await screen.findByText('A data final precisa ser igual ou posterior à data inicial'),
    ).toBeInTheDocument();
    expect(requests).toHaveLength(0);
  });

  it('shows a loading skeleton, then replaces it with the figures', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get('*/api/admin/finance/summary', async () => {
        await gate;
        return HttpResponse.json(buildSummary());
      }),
    );
    renderPage();

    expect(
      await screen.findByRole('status', { name: 'Carregando o resumo financeiro' }),
    ).toBeInTheDocument();
    release();

    await ready();
    expect(
      screen.queryByRole('status', { name: 'Carregando o resumo financeiro' }),
    ).not.toBeInTheDocument();
  });

  it('shows an empty state when there is no movement in either period', async () => {
    server.use(
      http.get('*/api/admin/finance/summary', () => HttpResponse.json(buildEmptySummary())),
    );
    renderPage();

    expect(
      await screen.findByText(
        /Nenhum movimento financeiro no período de 01\/05\/2026–26\/10\/2026/,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Receita líquida')).not.toBeInTheDocument();
  });

  it('shows the API error with "Tentar novamente", which refetches', async () => {
    let calls = 0;
    server.use(
      http.get('*/api/admin/finance/summary', () => {
        calls += 1;
        // The first attempt and its automatic retry fail; the manual retry succeeds.
        return calls <= 2
          ? apiError(500, 'INTERNAL', 'Falha ao calcular o resumo.')
          : HttpResponse.json(buildSummary());
      }),
    );
    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent('Falha ao calcular o resumo.');

    await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));

    await ready();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  describe('Exportar DRE (.xlsx)', () => {
    beforeEach(() => {
      URL.createObjectURL = vi.fn(() => 'blob:dre');
      URL.revokeObjectURL = vi.fn();
    });
    afterEach(() => {
      // jsdom has neither; remove the stubs so other tests see the platform as it is.
      Reflect.deleteProperty(URL, 'createObjectURL');
      Reflect.deleteProperty(URL, 'revokeObjectURL');
    });

    it('downloads the workbook for the current selection under the API file name', async () => {
      stubSummary();
      let exported: URL | null = null;
      server.use(
        http.get('*/api/admin/finance/dre.xlsx', ({ request }) => {
          exported = new URL(request.url);
          return new HttpResponse(new Uint8Array([80, 75, 3, 4]), {
            headers: {
              'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            },
          });
        }),
      );
      const saved: string[] = [];
      const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
        this: HTMLAnchorElement,
      ) {
        saved.push(this.download);
      });
      renderPage('/admin/financeiro?regime=accrual');
      await ready();

      await userEvent.click(screen.getByRole('link', { name: 'Exportar DRE (.xlsx)' }));

      await waitFor(() => {
        expect(saved).toEqual(['dre-accrual-2026-05-01-2026-10-26.xlsx']);
      });
      expect((exported as URL | null)?.searchParams.get('regime')).toBe('accrual');
      click.mockRestore();
    });

    it('shows the API error when the export fails', async () => {
      stubSummary();
      server.use(
        http.get('*/api/admin/finance/dre.xlsx', () =>
          apiError(403, 'FORBIDDEN', 'Você não tem permissão para exportar.'),
        ),
      );
      renderPage();
      await ready();

      await userEvent.click(screen.getByRole('link', { name: 'Exportar DRE (.xlsx)' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Você não tem permissão para exportar.',
      );
    });
  });
});
