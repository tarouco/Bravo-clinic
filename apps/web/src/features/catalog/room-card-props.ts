import type { RoomSummary } from '@bravo/core';
import type { RoomCardProps } from '../../components/ui/RoomCard';

type RoomCardData = Omit<RoomCardProps, 'onReserve' | 'featureChip'>;

/** RoomCard content of an API room: cover (placeholder when null), "ideal para" tags, price. */
export function roomCardData(room: RoomSummary): RoomCardData {
  return {
    name: room.name,
    imageUrl: room.cover?.url,
    imageAlt: room.cover?.alt,
    tags: room.idealFor,
    description: room.description,
    equipment: room.equipment,
    fromPriceCents: room.fromPriceCents,
  };
}
