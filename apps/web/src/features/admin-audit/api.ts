import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { withQuery } from '../../lib/query-string';
import type { AuditPage } from './contracts';

export interface AuditFilters {
  actorId: string;
  origin: string;
  actionPrefix: string;
  entityType: string;
  entityId: string;
  from: string;
  to: string;
}

export const EMPTY_FILTERS: AuditFilters = {
  actorId: '',
  origin: '',
  actionPrefix: '',
  entityType: '',
  entityId: '',
  from: '',
  to: '',
};

export const auditKeys = { list: (filters: AuditFilters) => ['admin', 'audit', filters] as const };

/** `GET /api/admin/audit`, newest first, at most 100 per page (GES-115). */
export function useAudit(filters: AuditFilters) {
  return useInfiniteQuery<
    AuditPage,
    Error,
    { pages: AuditPage[] },
    readonly unknown[],
    string | null
  >({
    queryKey: auditKeys.list(filters),
    initialPageParam: null,
    getNextPageParam: (last) => last.nextCursor,
    queryFn: ({ pageParam }) =>
      api.get<AuditPage>(withQuery('/api/admin/audit', { ...filters, cursor: pageParam })),
  });
}
