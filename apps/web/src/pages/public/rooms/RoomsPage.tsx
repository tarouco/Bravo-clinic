import { useNavigate } from 'react-router-dom';
import { Eyebrow } from '../../../components/ui/Brand';
import { Button } from '../../../components/ui/Button';
import { Alert, Spinner } from '../../../components/ui/Feedback';
import { RoomCard } from '../../../components/ui/RoomCard';
import { useRooms } from '../../../features/catalog/api';
import { roomCardData } from '../../../features/catalog/room-card-props';
import { track } from '../../../lib/analytics';
import { usePageTitle } from '../../../lib/usePageTitle';

/** `/salas`: one card per active room with cover, "ideal para" tags and the lowest hourly rate. */
export function RoomsPage() {
  usePageTitle('Salas');
  const navigate = useNavigate();
  const { data, isPending, isError, refetch } = useRooms();

  return (
    <section className="mx-auto max-w-7xl space-y-space-2xl px-gutter py-space-3xl">
      <div className="max-w-2xl space-y-space-xs">
        <Eyebrow>ESPAÇOS SOB DEMANDA</Eyebrow>
        <h1 className="font-display-l-mobile text-display-l-mobile text-ink md:font-display-l md:text-display-l">
          As salas inteligentes da clínica.
        </h1>
        <p className="font-body text-body text-ink-muted">
          Escolha a sala, veja os horários livres e reserve em poucos cliques.
        </p>
      </div>

      {isPending ? (
        <div className="flex justify-center py-space-2xl">
          <Spinner label="Carregando salas" />
        </div>
      ) : isError ? (
        <Alert tone="error">
          <p>Não foi possível carregar as salas agora.</p>
          <Button
            variant="link"
            onClick={() => {
              void refetch();
            }}
          >
            Tentar novamente
          </Button>
        </Alert>
      ) : (
        <div className="grid grid-cols-1 gap-space-xl lg:grid-cols-3">
          {data.items.map((room) => (
            <RoomCard
              key={room.id}
              {...roomCardData(room)}
              onReserve={() => {
                track('view_room', { slug: room.slug, name: room.name });
                void navigate(`/salas/${room.slug}`);
              }}
            />
          ))}
        </div>
      )}
    </section>
  );
}
