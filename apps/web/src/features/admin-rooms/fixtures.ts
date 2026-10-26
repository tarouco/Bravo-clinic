import { parseFixture } from '../../test/fixtures/parse';
import { adminRoomListSchema, type AdminRoom, type AdminRoomList } from './contracts';

// Salas fixtures for the web tests, validated against the response contracts (AD-035).

export const ROOM_IDS = {
  aurora: 'a1000000-0000-4000-8000-000000000001',
  boreal: 'a1000000-0000-4000-8000-000000000002',
} as const;

export const PHOTO_IDS = {
  cover: 'f1000000-0000-4000-8000-000000000001',
  second: 'f1000000-0000-4000-8000-000000000002',
  third: 'f1000000-0000-4000-8000-000000000003',
} as const;

const photo = (id: string, key: string, alt: string, isCover: boolean, displayOrder: number) => ({
  id,
  storageKey: `rooms/${ROOM_IDS.aurora}/${key}`,
  alt,
  isCover,
  displayOrder,
  width: 1600,
  height: 1200,
});

/** Aurora (active, three photos, first is the cover) and Boreal (inactive, no photos). */
export function buildRooms(overrides: Partial<AdminRoom> = {}): AdminRoomList {
  return parseFixture(
    adminRoomListSchema,
    {
      items: [
        {
          id: ROOM_IDS.aurora,
          name: 'Sala Aurora',
          slug: 'aurora',
          description: 'Sala ampla com luz natural.',
          idealFor: ['Psicologia', 'Fisioterapia'],
          equipment: ['Maca', 'Ar-condicionado'],
          displayOrder: 1,
          status: 'active',
          photos: [
            photo(PHOTO_IDS.cover, 'up-1', 'Vista geral da sala', true, 0),
            photo(PHOTO_IDS.second, 'up-2', 'Maca e janela', false, 1),
            photo(PHOTO_IDS.third, 'up-3', 'Recepção', false, 2),
          ],
          ...overrides,
        },
        {
          id: ROOM_IDS.boreal,
          name: 'Sala Boreal',
          slug: 'boreal',
          description: '',
          idealFor: [],
          equipment: [],
          displayOrder: 2,
          status: 'inactive',
          photos: [],
        },
      ],
    },
    'adminRooms',
  );
}
