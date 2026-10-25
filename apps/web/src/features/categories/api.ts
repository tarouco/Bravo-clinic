import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminCategory, CategoryCreateInput, CategoryUpdateInput } from '@bravo/core';
import { api } from '../../lib/api';
import { catalogKeys } from '../catalog/api';

export const categoryKeys = { all: ['admin', 'categories'] as const };

/** Price changes also change what the public catalog shows. */
function useInvalidateCategories() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: categoryKeys.all });
    void queryClient.invalidateQueries({ queryKey: catalogKeys.catalog });
    void queryClient.invalidateQueries({ queryKey: catalogKeys.rooms });
  };
}

export function useCategories() {
  return useQuery<{ items: AdminCategory[] }>({
    queryKey: categoryKeys.all,
    queryFn: () => api.get<{ items: AdminCategory[] }>('/api/admin/categories'),
  });
}

export function useCreateCategory() {
  const invalidate = useInvalidateCategories();
  return useMutation<AdminCategory, Error, CategoryCreateInput>({
    mutationFn: (input) => api.post<AdminCategory>('/api/admin/categories', input),
    onSuccess: invalidate,
  });
}

export function useUpdateCategory(id: string) {
  const invalidate = useInvalidateCategories();
  return useMutation<AdminCategory, Error, CategoryUpdateInput>({
    mutationFn: (input) => api.patch<AdminCategory>(`/api/admin/categories/${id}`, input),
    onSuccess: invalidate,
  });
}

export function useSetReferenceCategory() {
  const invalidate = useInvalidateCategories();
  return useMutation<AdminCategory, Error, string>({
    mutationFn: (id) => api.post<AdminCategory>(`/api/admin/categories/${id}/reference`, {}),
    onSuccess: invalidate,
  });
}

export function useReorderCategories() {
  const invalidate = useInvalidateCategories();
  return useMutation<{ items: AdminCategory[] }, Error, string[]>({
    mutationFn: (ids) =>
      api.post<{ items: AdminCategory[] }>('/api/admin/categories/reorder', { ids }),
    onSuccess: invalidate,
  });
}

/** "Revisei os preços": opens online booking for tenants (US-12). */
export function useConfirmPricesReviewed() {
  const invalidate = useInvalidateCategories();
  const queryClient = useQueryClient();
  return useMutation<{ pricesReviewed: true }, Error, void>({
    mutationFn: () =>
      api.post<{ pricesReviewed: true }>('/api/admin/onboarding/prices-reviewed', {}),
    onSuccess: () => {
      invalidate();
      void queryClient.invalidateQueries({ queryKey: ['admin', 'calendar', 'config'] });
    },
  });
}
