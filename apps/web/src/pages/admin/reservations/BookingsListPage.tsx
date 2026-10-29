import { BOOKING_STATUSES, bookingStatusLabel, formatBRL } from '@bravo/core';
import { Download } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { StatusBadge } from '../../../components/booking/StatusBadge';
import { Button } from '../../../components/ui/Button';
import { Alert, Spinner } from '../../../components/ui/Feedback';
import { Input, Select } from '../../../components/ui/form';
import { Table, useCsvDownload, type TableColumn } from '../../../components/ui/Table';
import { useCatalog, useRooms } from '../../../features/catalog/api';
import {
  adminBookingsCsvUrl,
  useAdminBookings,
  type AdminBookingFilters,
} from '../../../features/reservations/api';
import { messageOf } from '../../../lib/api-errors';
import { bookingWhen } from '../../../lib/booking-time';

type Row = NonNullable<
  ReturnType<typeof useAdminBookings>['data']
>['pages'][number]['items'][number];

const FILTER_KEYS = ['q', 'status', 'roomId', 'categoryId', 'from', 'to'] as const;

const SOURCE_LABELS: Record<Row['source'], string> = {
  web: 'Site',
  app: 'App',
  admin: 'Recepção',
  mcp: 'Assistente',
};

const COLUMNS: TableColumn<Row>[] = [
  { id: 'code', header: 'Código', cell: (row) => row.code, sortValue: (row) => row.code },
  {
    id: 'customer',
    header: 'Cliente',
    cell: (row) => (
      <>
        <span className="block font-medium">{row.customerName}</span>
        <span className="block text-ink-muted">{row.customerEmail}</span>
      </>
    ),
    sortValue: (row) => row.customerName,
  },
  { id: 'room', header: 'Sala', cell: (row) => row.roomName, sortValue: (row) => row.roomName },
  {
    id: 'start',
    header: 'Início',
    cell: (row) => bookingWhen(row.startsAt, row.endsAt),
    sortValue: (row) => row.startsAt,
  },
  {
    id: 'status',
    header: 'Status',
    cell: (row) => <StatusBadge status={row.status} paymentStatus={row.paymentStatus} />,
  },
  {
    id: 'total',
    header: 'Total',
    align: 'right',
    cell: (row) => formatBRL(row.totalCents),
    sortValue: (row) => row.totalCents,
  },
  {
    id: 'paid',
    header: 'Pago',
    align: 'right',
    cell: (row) => formatBRL(row.paidCents),
    sortValue: (row) => row.paidCents,
  },
  { id: 'source', header: 'Origem', cell: (row) => SOURCE_LABELS[row.source] },
];

/** Lista sub-tab: searchable, filterable table of bookings with CSV export (NUC-179). */
export function BookingsListPage() {
  const [params, setParams] = useSearchParams();
  const rooms = useRooms();
  const catalog = useCatalog();
  const csv = useCsvDownload();

  const filters: AdminBookingFilters = {};
  for (const key of FILTER_KEYS) {
    const value = params.get(key);
    if (value) Object.assign(filters, { [key]: value });
  }
  const list = useAdminBookings(filters);
  const rows = list.data?.pages.flatMap((page) => page.items) ?? [];

  const setFilter =
    (key: (typeof FILTER_KEYS)[number]) => (event: { target: { value: string } }) => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (event.target.value) next.set(key, event.target.value);
          else next.delete(key);
          return next;
        },
        { replace: true },
      );
    };

  const categories = [
    ...(catalog.data?.hourly ?? []).map((c) => ({ id: c.id, name: c.name })),
    ...(catalog.data?.blocks ?? []).map((c) => ({ id: c.id, name: c.name })),
  ];

  return (
    <section aria-labelledby="bookings-list-title" className="space-y-space-md">
      <h2 id="bookings-list-title" className="sr-only">
        Lista de reservas
      </h2>
      <div className="grid gap-space-md sm:grid-cols-2 lg:grid-cols-3">
        <Input
          label="Buscar"
          type="search"
          placeholder="Código, cliente ou e-mail"
          value={params.get('q') ?? ''}
          onChange={setFilter('q')}
        />
        <Select label="Status" value={params.get('status') ?? ''} onChange={setFilter('status')}>
          <option value="">Todos os status</option>
          {BOOKING_STATUSES.map((status) => (
            <option key={status} value={status}>
              {bookingStatusLabel[status]}
            </option>
          ))}
        </Select>
        <Select label="Sala" value={params.get('roomId') ?? ''} onChange={setFilter('roomId')}>
          <option value="">Todas as salas</option>
          {(rooms.data?.items ?? []).map((room) => (
            <option key={room.id} value={room.id}>
              {room.name}
            </option>
          ))}
        </Select>
        <Select
          label="Categoria"
          value={params.get('categoryId') ?? ''}
          onChange={setFilter('categoryId')}
        >
          <option value="">Todas as categorias</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </Select>
        <Input
          label="De"
          type="date"
          value={params.get('from') ?? ''}
          onChange={setFilter('from')}
        />
        <Input label="Até" type="date" value={params.get('to') ?? ''} onChange={setFilter('to')} />
      </div>

      <div className="flex justify-end">
        <Button
          variant="secondary"
          size="sm"
          leadingIcon={Download}
          loading={csv.pending}
          onClick={() => {
            void csv.download(adminBookingsCsvUrl(filters), 'reservas.csv');
          }}
        >
          Exportar CSV
        </Button>
      </div>
      {csv.error ? <Alert tone="error">{csv.error.message}</Alert> : null}

      {list.isPending ? <Spinner label="Carregando reservas" /> : null}
      {list.isError ? (
        <Alert tone="error">
          {messageOf(list.error, 'Não foi possível carregar as reservas.')}
        </Alert>
      ) : null}
      {list.data ? (
        <Table
          caption="Reservas"
          columns={COLUMNS}
          rows={rows}
          rowKey={(row) => row.id}
          defaultSort={{ columnId: 'start', direction: 'desc' }}
          density="compact"
          emptyMessage="Nenhuma reserva encontrada com estes filtros."
        />
      ) : null}
      {list.hasNextPage ? (
        <div className="flex justify-center">
          <Button
            variant="secondary"
            loading={list.isFetchingNextPage}
            onClick={() => {
              void list.fetchNextPage();
            }}
          >
            Carregar mais
          </Button>
        </div>
      ) : null}
    </section>
  );
}
