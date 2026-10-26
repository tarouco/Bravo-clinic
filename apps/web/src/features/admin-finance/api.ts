import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { FinanceQuery } from '@bravo/core';
import { api } from '../../lib/api';
import { withQuery } from '../../lib/query-string';
import type { FinanceSummary } from './contracts';

// Gestao finance data layer (design "Finance services" and "Web: Admin screens"): TanStack Query
// keys `['admin', 'finance', ...]`, one hook per endpoint.

export const financeKeys = {
  all: ['admin', 'finance'] as const,
  summary: (query: FinanceQuery | null) => ['admin', 'finance', 'summary', query] as const,
};

/** `GET /api/admin/finance/summary`; idle while the selection is invalid (`query` null). */
export function useFinanceSummary(query: FinanceQuery | null) {
  return useQuery<FinanceSummary>({
    queryKey: financeKeys.summary(query),
    enabled: query !== null,
    // Keep the previous figures on screen while a changed selection loads.
    placeholderData: keepPreviousData,
    queryFn: () => {
      if (!query) throw new Error('Finance summary requested without a valid selection.');
      return api.get<FinanceSummary>(
        withQuery('/api/admin/finance/summary', {
          from: query.from,
          to: query.to,
          grouping: query.grouping,
          regime: query.regime,
        }),
      );
    },
  });
}

/** `GET /api/admin/finance/dre.xlsx` for the same selection as the summary (GES-28, GES-29). */
export function dreExportUrl(query: FinanceQuery): string {
  return withQuery('/api/admin/finance/dre.xlsx', {
    from: query.from,
    to: query.to,
    regime: query.regime,
  });
}

export function dreFileName(query: FinanceQuery): string {
  return `dre-${query.regime}-${query.from}-${query.to}.xlsx`;
}
