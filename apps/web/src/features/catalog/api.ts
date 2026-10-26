import { useQuery } from '@tanstack/react-query';
import type { Catalog, Clinic, PoliciesPublic, RoomDetail, RoomList } from '@bravo/core';
import { api } from '../../lib/api';

// Public catalog hooks (design.md "API Contract / Public"). Catalog data changes rarely: 5 min.
const FIVE_MINUTES_MS = 5 * 60 * 1000;

export const catalogKeys = {
  rooms: ['public', 'rooms'] as const,
  room: (slug: string) => ['public', 'rooms', slug] as const,
  catalog: ['public', 'catalog'] as const,
  clinic: ['public', 'clinic'] as const,
  policies: ['public', 'policies'] as const,
};

export function useRooms() {
  return useQuery<RoomList>({
    queryKey: catalogKeys.rooms,
    staleTime: FIVE_MINUTES_MS,
    queryFn: () => api.get<RoomList>('/api/public/rooms'),
  });
}

export function useRoom(slug: string | undefined) {
  return useQuery<RoomDetail>({
    queryKey: catalogKeys.room(slug ?? ''),
    enabled: slug !== undefined && slug !== '',
    staleTime: FIVE_MINUTES_MS,
    queryFn: () => api.get<RoomDetail>(`/api/public/rooms/${encodeURIComponent(slug ?? '')}`),
  });
}

export function useCatalog() {
  return useQuery<Catalog>({
    queryKey: catalogKeys.catalog,
    staleTime: FIVE_MINUTES_MS,
    queryFn: () => api.get<Catalog>('/api/public/catalog'),
  });
}

export function useClinic() {
  return useQuery<Clinic>({
    queryKey: catalogKeys.clinic,
    staleTime: FIVE_MINUTES_MS,
    queryFn: () => api.get<Clinic>('/api/public/clinic'),
  });
}

export function usePolicies() {
  return useQuery<PoliciesPublic>({
    queryKey: catalogKeys.policies,
    staleTime: FIVE_MINUTES_MS,
    queryFn: () => api.get<PoliciesPublic>('/api/public/policies'),
  });
}
