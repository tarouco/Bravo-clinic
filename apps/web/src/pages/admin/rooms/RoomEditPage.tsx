import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button } from '../../../components/ui/Button';
import { Alert, Spinner } from '../../../components/ui/Feedback';
import { useAdminRooms } from '../../../features/admin-rooms/api';
import { PhotoManager } from '../../../features/admin-rooms/PhotoManager';
import { RoomForm } from '../../../features/admin-rooms/RoomForm';
import { messageOf } from '../../../lib/api-errors';
import { usePageTitle } from '../../../lib/usePageTitle';

/** The id segment that opens the form for a new room. */
export const NEW_ROOM_SEGMENT = 'nova';

/**
 * `/admin/salas/:id`: room data and its photo manager; `/admin/salas/nova` creates a room and
 * then opens its editor, where photos can be added (GES-103..GES-109).
 */
export function RoomEditPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const rooms = useAdminRooms();
  const creating = id === NEW_ROOM_SEGMENT;
  const room = creating ? null : (rooms.data?.items.find((r) => r.id === id) ?? null);
  usePageTitle(creating ? 'Nova sala' : (room?.name ?? 'Sala'));

  const back = (
    <Link
      to="/admin/salas"
      className="font-small text-small text-bronze underline underline-offset-4"
    >
      Voltar para salas
    </Link>
  );

  if (rooms.isPending) {
    return (
      <div className="flex justify-center py-space-3xl">
        <Spinner label="Carregando a sala" />
      </div>
    );
  }
  if (rooms.isError) {
    return (
      <div className="mx-auto max-w-4xl space-y-space-md">
        {back}
        <Alert tone="error">
          <p>{messageOf(rooms.error, 'Não foi possível carregar a sala.')}</p>
          <Button
            variant="secondary"
            size="sm"
            className="mt-space-sm"
            onClick={() => {
              void rooms.refetch();
            }}
          >
            Tentar novamente
          </Button>
        </Alert>
      </div>
    );
  }
  if (!creating && !room) {
    return (
      <div className="mx-auto max-w-4xl space-y-space-md">
        {back}
        <Alert tone="error">Sala não encontrada.</Alert>
      </div>
    );
  }

  const nextOrder = rooms.data.items.reduce((max, r) => Math.max(max, r.displayOrder), 0) + 1;

  return (
    <div className="mx-auto max-w-4xl space-y-space-lg">
      <div>
        {back}
        <h1 className="mt-space-sm font-heading text-heading-mobile text-ink md:text-heading">
          {room ? room.name : 'Nova sala'}
        </h1>
      </div>

      <section
        aria-labelledby="room-data"
        className="space-y-space-md rounded-card border border-hairline bg-surface-raised p-space-lg"
      >
        <h2 id="room-data" className="font-heading text-heading-mobile text-ink">
          Dados da sala
        </h2>
        <RoomForm
          // A saved room keeps the form; switching rooms starts a fresh one.
          key={room?.id ?? 'new'}
          room={room}
          nextOrder={nextOrder}
          onCreated={(created) => {
            void navigate(`/admin/salas/${created.id}`, { replace: true });
          }}
        />
      </section>

      <section
        aria-labelledby="room-photos"
        className="space-y-space-md rounded-card border border-hairline bg-surface-raised p-space-lg"
      >
        <h2 id="room-photos" className="font-heading text-heading-mobile text-ink">
          Fotos
        </h2>
        {room ? (
          <PhotoManager roomId={room.id} photos={room.photos} />
        ) : (
          <p className="font-small text-small text-ink-muted">Salve a sala para enviar as fotos.</p>
        )}
      </section>
    </div>
  );
}
