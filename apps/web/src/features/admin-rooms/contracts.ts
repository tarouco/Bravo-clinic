import { z } from 'zod';

// Response shapes of the gestao Salas admin routes (gestao design "Admin operations services").
// Core owns the request schemas; the responses are declared here so the MSW fixtures are
// validated against them (AD-035). The fields the design leaves open are listed in the design's
// "Web-assumed API contract" section.

export const roomPhotoSchema = z.object({
  id: z.string().min(1),
  /** `rooms/<roomId>/<uploadId>`; the images are `/media/<storageKey>-large|small.webp`. */
  storageKey: z.string().min(1),
  alt: z.string().min(1),
  isCover: z.boolean(),
  displayOrder: z.number().int().min(0),
  width: z.number().int().min(1),
  height: z.number().int().min(1),
});
export type RoomPhoto = z.infer<typeof roomPhotoSchema>;

export const adminRoomSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  slug: z.string().min(1),
  description: z.string(),
  idealFor: z.array(z.string()),
  equipment: z.array(z.string()),
  displayOrder: z.number().int().min(0),
  status: z.enum(['active', 'inactive']),
  /** In display order, the cover included. */
  photos: z.array(roomPhotoSchema),
});
export type AdminRoom = z.infer<typeof adminRoomSchema>;

/** `GET /api/admin/rooms`: every room with its photos, inactive ones included. */
export const adminRoomListSchema = z.object({ items: z.array(adminRoomSchema) });
export type AdminRoomList = z.infer<typeof adminRoomListSchema>;
