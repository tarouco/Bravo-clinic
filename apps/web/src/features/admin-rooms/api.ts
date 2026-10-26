import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { RoomInput, RoomPhotoInput } from '@bravo/core';
import { api } from '../../lib/api';
import type { AdminRoom, AdminRoomList, RoomPhoto } from './contracts';
import type { PreparedPhoto } from './prepare-photo';

// Gestao Salas data layer: one TanStack Query key, `['admin', 'rooms']`; every write invalidates it.

export const roomKeys = { all: ['admin', 'rooms'] as const };

const ROOMS = '/api/admin/rooms';

/** `GET /api/admin/rooms` (GES-103). */
export function useAdminRooms() {
  return useQuery<AdminRoomList>({
    queryKey: roomKeys.all,
    queryFn: () => api.get(ROOMS),
  });
}

export function useCreateRoom() {
  const queryClient = useQueryClient();
  return useMutation<AdminRoom, Error, RoomInput>({
    mutationFn: (input) => api.post(ROOMS, input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: roomKeys.all }),
  });
}

/** `PATCH .../rooms/:id`; inactivating a room with commitments is a 409 (GES-104). */
export function useUpdateRoom(id: string) {
  const queryClient = useQueryClient();
  return useMutation<AdminRoom, Error, RoomInput>({
    mutationFn: (input) => api.patch(`${ROOMS}/${id}`, input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: roomKeys.all }),
  });
}

export interface AddPhotoVariables {
  prepared: PreparedPhoto;
  alt: string;
  /** Called with 1/3, 2/3 and 1 as the large variant, the small one and the registration finish. */
  onProgress?: (fraction: number) => void;
}

/**
 * The upload of one photo (GES-105): the `large` and `small` WebP variants as raw `PUT`s under a
 * fresh upload id, then the registration with the alt text.
 */
export function useAddRoomPhoto(roomId: string) {
  const queryClient = useQueryClient();
  return useMutation<RoomPhoto, Error, AddPhotoVariables>({
    mutationFn: async ({ prepared, alt, onProgress }) => {
      const uploadId = crypto.randomUUID();
      const base = `${ROOMS}/${roomId}/photo-uploads/${uploadId}`;
      onProgress?.(0);
      await api.upload(`${base}/large`, prepared.large);
      onProgress?.(1 / 3);
      await api.upload(`${base}/small`, prepared.small);
      onProgress?.(2 / 3);
      const body: RoomPhotoInput = {
        uploadId,
        alt,
        width: prepared.width,
        height: prepared.height,
      };
      const photo = await api.post<RoomPhoto>(`${ROOMS}/${roomId}/photos`, body);
      onProgress?.(1);
      return photo;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: roomKeys.all }),
  });
}

export interface UpdatePhotoVariables {
  photoId: string;
  body: { alt?: string; isCover?: boolean; displayOrder?: number };
}

export function useUpdateRoomPhoto(roomId: string) {
  const queryClient = useQueryClient();
  return useMutation<RoomPhoto, Error, UpdatePhotoVariables>({
    mutationFn: ({ photoId, body }) => api.patch(`${ROOMS}/${roomId}/photos/${photoId}`, body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: roomKeys.all }),
  });
}

/** `PUT .../photos/order` with every photo id in the wanted order (GES-107). */
export function useReorderRoomPhotos(roomId: string) {
  const queryClient = useQueryClient();
  return useMutation<unknown, Error, string[]>({
    mutationFn: (ids) => api.put(`${ROOMS}/${roomId}/photos/order`, { ids }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: roomKeys.all }),
  });
}

export function useDeleteRoomPhoto(roomId: string) {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (photoId) => api.delete(`${ROOMS}/${roomId}/photos/${photoId}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: roomKeys.all }),
  });
}
