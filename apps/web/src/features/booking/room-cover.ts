import { ROOM_PLACEHOLDER_SRC } from '../../components/ui/RoomCard';
import { useRooms } from '../catalog/api';

export interface RoomCover {
  src: string;
  /** Empty when the photo only decorates a row whose text already names the room. */
  alt: string;
}

/**
 * Cover photo of a room for the app's rows and booking detail, from the public room list (cached
 * for 5 minutes); the placeholder while it loads or when the room has no photo.
 */
export function useRoomCover(slug: string): RoomCover {
  const rooms = useRooms();
  const cover = rooms.data?.items.find((room) => room.slug === slug)?.cover;
  return cover ? { src: cover.url, alt: cover.alt } : { src: ROOM_PLACEHOLDER_SRC, alt: '' };
}
