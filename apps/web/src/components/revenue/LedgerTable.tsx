import {
  formatDateTime,
  formatMinutes,
  formatSignedMinutes,
} from '../../features/purchases/format';
import type { LedgerEntry } from '../../features/purchases/types';
import { Button } from '../ui/Button';
import { Table, type TableColumn } from '../ui/Table';

export interface LedgerTableProps {
  /** Entries newest first, as the API returns them. */
  items: readonly LedgerEntry[];
  /** True while the API reports a `nextCursor`; shows "Carregar mais". */
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
}

const columns: readonly TableColumn<LedgerEntry>[] = [
  { id: 'at', header: 'Data', cell: (entry) => formatDateTime(entry.at) },
  {
    id: 'label',
    header: 'Lançamento',
    cell: (entry) => (
      <span className="flex flex-col">
        <span>{entry.label}</span>
        {entry.kind === 'extra' ? (
          <span className="font-caption text-caption text-ink-muted">Horas extras</span>
        ) : null}
      </span>
    ),
  },
  {
    id: 'booking',
    header: 'Código da reserva',
    cell: (entry) => entry.bookingCode ?? '',
  },
  {
    id: 'detail',
    header: 'Cálculo',
    cell: (entry) => entry.detailText ?? '',
  },
  {
    id: 'minutes',
    header: 'Minutos',
    align: 'right',
    cell: (entry) => (
      <span className="whitespace-nowrap font-semibold">{formatSignedMinutes(entry.minutes)}</span>
    ),
  },
  {
    id: 'balance',
    header: 'Saldo',
    align: 'right',
    cell: (entry) => <span className="whitespace-nowrap">{formatMinutes(entry.balanceAfter)}</span>,
  },
];

/** Extrato of a subscription: signed minutes, balance after and the debit formula (REC-41, REC-42). */
export function LedgerTable({
  items,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
}: LedgerTableProps) {
  return (
    <div className="space-y-space-md">
      <Table
        caption="Extrato de minutos"
        columns={columns}
        rows={items}
        rowKey={(entry) => entry.id}
        emptyMessage="Nenhum lançamento ainda."
      />
      {hasMore ? (
        <Button variant="secondary" loading={loadingMore} onClick={onLoadMore}>
          Carregar mais
        </Button>
      ) : null}
    </div>
  );
}
