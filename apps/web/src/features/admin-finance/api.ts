import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type {
  ExpenseCategoryInput,
  ExpenseInput,
  FinanceQuery,
  ManualReceiptInput,
} from '@bravo/core';
import { api } from '../../lib/api';
import { withQuery } from '../../lib/query-string';
import type { Expense, ExpenseCategory, FinanceSummary, ManualReceipt } from './contracts';

// Gestao finance data layer (design "Finance services" and "Web: Admin screens"): TanStack Query
// keys `['admin', 'finance', ...]`, one hook per endpoint. Every write invalidates the whole
// `['admin', 'finance']` tree, so the overview figures follow the lists.

export const financeKeys = {
  all: ['admin', 'finance'] as const,
  summary: (query: FinanceQuery | null) => ['admin', 'finance', 'summary', query] as const,
  categories: ['admin', 'finance', 'expense-categories'] as const,
  expenses: (filters: ListFilters) => ['admin', 'finance', 'expenses', filters] as const,
  receipts: (filters: ListFilters) => ['admin', 'finance', 'receipts', filters] as const,
};

interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface ListFilters {
  from: string;
  to: string;
  categoryId?: string;
}

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

// ---- Expense categories (GES-19) ----

/** Categories in display order, inactive ones included (the drawer manages them). */
export function useExpenseCategories() {
  return useQuery<{ items: ExpenseCategory[] }>({
    queryKey: financeKeys.categories,
    queryFn: () => api.get('/api/admin/finance/expense-categories'),
  });
}

export function useCreateExpenseCategory() {
  const queryClient = useQueryClient();
  return useMutation<ExpenseCategory, Error, ExpenseCategoryInput>({
    mutationFn: (input) => api.post('/api/admin/finance/expense-categories', input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: financeKeys.all }),
  });
}

export interface UpdateExpenseCategoryVariables {
  id: string;
  body: Partial<ExpenseCategoryInput>;
}

export function useUpdateExpenseCategory() {
  const queryClient = useQueryClient();
  return useMutation<ExpenseCategory, Error, UpdateExpenseCategoryVariables>({
    mutationFn: ({ id, body }) => api.patch(`/api/admin/finance/expense-categories/${id}`, body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: financeKeys.all }),
  });
}

// ---- Expenses (GES-11..GES-18) ----

export function useExpenses(filters: ListFilters) {
  return useInfiniteQuery<
    Page<Expense>,
    Error,
    { pages: Page<Expense>[] },
    readonly unknown[],
    string | null
  >({
    queryKey: financeKeys.expenses(filters),
    initialPageParam: null,
    getNextPageParam: (last) => last.nextCursor,
    queryFn: ({ pageParam }) =>
      api.get<Page<Expense>>(
        withQuery('/api/admin/finance/expenses', {
          from: filters.from,
          to: filters.to,
          categoryId: filters.categoryId,
          cursor: pageParam,
        }),
      ),
  });
}

export function useCreateExpense() {
  const queryClient = useQueryClient();
  return useMutation<Expense, Error, ExpenseInput>({
    mutationFn: (input) => api.post('/api/admin/finance/expenses', input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: financeKeys.all }),
  });
}

export function useUpdateExpense(id: string) {
  const queryClient = useQueryClient();
  return useMutation<Expense, Error, Partial<ExpenseInput>>({
    mutationFn: (input) => api.patch(`/api/admin/finance/expenses/${id}`, input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: financeKeys.all }),
  });
}

export function useDeleteExpense() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => api.delete(`/api/admin/finance/expenses/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: financeKeys.all }),
  });
}

export const expenseAttachmentUrl = (id: string): string =>
  `/api/admin/finance/expenses/${id}/attachment`;

/** `PUT .../attachment` with the raw file (PDF, JPEG, PNG or WebP up to 5 MiB; GES-16, GES-17). */
export function useUploadExpenseAttachment() {
  const queryClient = useQueryClient();
  return useMutation<Expense, Error, { id: string; file: File }>({
    mutationFn: ({ id, file }) => api.upload(expenseAttachmentUrl(id), file),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: financeKeys.all }),
  });
}

export function useDeleteExpenseAttachment() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => api.delete(expenseAttachmentUrl(id)),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: financeKeys.all }),
  });
}

// ---- Manual receipts (GES-20, GES-21) ----

export function useReceipts(filters: ListFilters) {
  return useInfiniteQuery<
    Page<ManualReceipt>,
    Error,
    { pages: Page<ManualReceipt>[] },
    readonly unknown[],
    string | null
  >({
    queryKey: financeKeys.receipts(filters),
    initialPageParam: null,
    getNextPageParam: (last) => last.nextCursor,
    queryFn: ({ pageParam }) =>
      api.get<Page<ManualReceipt>>(
        withQuery('/api/admin/finance/receipts', {
          from: filters.from,
          to: filters.to,
          cursor: pageParam,
        }),
      ),
  });
}

export function useCreateReceipt() {
  const queryClient = useQueryClient();
  return useMutation<ManualReceipt, Error, ManualReceiptInput>({
    mutationFn: (input) => api.post('/api/admin/finance/receipts', input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: financeKeys.all }),
  });
}

export function useDeleteReceipt() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, { id: string; justification: string }>({
    mutationFn: ({ id, justification }) =>
      api.delete(`/api/admin/finance/receipts/${id}`, { justification }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: financeKeys.all }),
  });
}
