/** Slugs of the three clinic rooms; same values as the seeded `rooms.slug` column. */
export const ROOM_SLUGS = ['principal', 'secundaria', 'terceira'] as const;

export type RoomSlug = (typeof ROOM_SLUGS)[number];

export function isRoomSlug(value: string): value is RoomSlug {
  return (ROOM_SLUGS as readonly string[]).includes(value);
}
