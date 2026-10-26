import { SlidersHorizontal } from 'lucide-react';
import { Eyebrow } from '../../../components/ui/Brand';
import { Icon } from '../../../components/ui/Icon';
import { RoomCard } from '../../../components/ui/RoomCard';
import { useRooms } from '../../../features/catalog/api';
import { roomCardData } from '../../../features/catalog/room-card-props';
import { staticRooms } from '../../../features/home/rooms.static';

export interface RoomsSectionProps {
  onReserve: (slug: string) => void;
}

/** Cards of the live rooms; the static reference copy shows while loading or when the API fails. */
function useHomeRooms() {
  const { data } = useRooms();
  if (!data) return staticRooms.map((room) => ({ ...room, slug: room.slug }));
  return data.items.map((room) => ({
    ...roomCardData(room),
    slug: room.slug,
    featureChip: staticRooms.find((s) => s.slug === room.slug)?.featureChip,
  }));
}

export function RoomsSection({ onReserve }: RoomsSectionProps) {
  const rooms = useHomeRooms();
  return (
    <section className="w-full py-space-3xl bg-surface scroll-mt-20" id="salas">
      <div className="max-w-7xl mx-auto px-gutter">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-space-md mb-space-2xl">
          <div className="space-y-space-xs max-w-2xl">
            <Eyebrow>ESPAÇOS SOB DEMANDA</Eyebrow>
            <h2 className="font-display-l-mobile text-display-l-mobile md:font-display-l md:text-display-l text-ink">
              As três salas inteligentes da clínica.
            </h2>
            <p className="font-body text-body text-ink-muted">
              Todas as salas compartilham do mesmo padrão estético e contam com tarifa unificada e
              transparente, variando apenas nas configurações específicas de equipamentos de
              procedimento ou terapias corporais.
            </p>
          </div>
          <div className="inline-flex items-center gap-space-xs text-ink-muted font-caption text-caption bg-surface-raised px-space-md py-space-xs rounded-full shadow-sm self-start md:self-auto">
            <Icon as={SlidersHorizontal} size={16} className="text-bronze shrink-0" />
            <span>Tarifa unificada: mesmo valor base em todas as salas</span>
          </div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-space-xl">
          {rooms.map((room) => (
            <RoomCard
              key={room.slug}
              name={room.name}
              imageUrl={room.imageUrl}
              imageAlt={room.imageAlt}
              featureChip={room.featureChip}
              tags={room.tags}
              description={room.description}
              equipment={room.equipment}
              fromPriceCents={room.fromPriceCents}
              onReserve={() => {
                onReserve(room.slug);
              }}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
