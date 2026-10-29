import { toPhotoUrl } from '@bravo/core';
import { Link } from 'react-router-dom';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Alert, Spinner } from '../../../components/ui/Feedback';
import { Table, type TableColumn } from '../../../components/ui/Table';
import { useAdminRooms } from '../../../features/admin-rooms/api';
import type { AdminRoom } from '../../../features/admin-rooms/contracts';
import { messageOf } from '../../../lib/api-errors';
import { usePageTitle } from '../../../lib/usePageTitle';
import { NEW_ROOM_SEGMENT } from './RoomEditPage';

const columns: readonly TableColumn<AdminRoom>[] = [
  {
    id: 'cover',
    header: 'Foto',
    cell: (r) => {
      const cover = r.photos.find((p) => p.isCover) ?? r.photos[0];
      return cover ? (
        <img
          src={toPhotoUrl(cover.storageKey, 'small')}
          alt={cover.alt}
          loading="lazy"
          className="h-12 w-16 rounded-sm object-cover"
        />
      ) : (
        <span className="text-ink-muted">Sem foto</span>
      );
    },
  },
  {
    id: 'name',
    header: 'Sala',
    sortValue: (r) => r.name,
    cell: (r) => (
      <Link
        to={`/admin/salas/${r.id}`}
        className="font-medium text-accent underline underline-offset-4"
      >
        {r.name}
      </Link>
    ),
  },
  {
    id: 'slug',
    header: 'Endereço',
    cell: (r) => <code className="font-mono">/salas/{r.slug}</code>,
  },
  {
    id: 'status',
    header: 'Situação',
    cell: (r) => (
      <Badge tone={r.status === 'active' ? 'emerald' : 'neutral'}>
        {r.status === 'active' ? 'Ativa' : 'Inativa'}
      </Badge>
    ),
  },
  { id: 'photos', header: 'Fotos', align: 'right', cell: (r) => String(r.photos.length) },
  {
    id: 'order',
    header: 'Ordem',
    align: 'right',
    sortValue: (r) => r.displayOrder,
    cell: (r) => String(r.displayOrder),
  },
];

/** `/admin/salas`: every room with its cover, status and photo count (GES-103). */
export function RoomsPage() {
  usePageTitle('Salas');
  const rooms = useAdminRooms();

  return (
    <div className="mx-auto max-w-5xl space-y-space-lg">
      <div className="flex flex-wrap items-center justify-between gap-space-sm">
        <h1 className="font-display-l-mobile text-display-l-mobile text-ink lg:font-display-l lg:text-display-l">
          Salas
        </h1>
        <Button asChild>
          <Link to={`/admin/salas/${NEW_ROOM_SEGMENT}`}>Nova sala</Link>
        </Button>
      </div>

      {rooms.isPending ? <Spinner label="Carregando as salas" /> : null}
      {rooms.isError ? (
        <Alert tone="error">
          <p>{messageOf(rooms.error, 'Não foi possível carregar as salas.')}</p>
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
      ) : null}
      {rooms.data ? (
        <Table
          caption="Salas"
          columns={columns}
          rows={rooms.data.items}
          rowKey={(r) => r.id}
          defaultSort={{ columnId: 'order', direction: 'asc' }}
          emptyMessage="Nenhuma sala cadastrada."
        />
      ) : null}
    </div>
  );
}
