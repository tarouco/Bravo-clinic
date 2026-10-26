import { formatBRL } from '@bravo/core';
import { Button } from '../../../components/ui/Button';
import { Alert, Spinner } from '../../../components/ui/Feedback';
import { Table, type TableColumn } from '../../../components/ui/Table';
import { useCredits, usePurchaseHistory } from '../../../features/purchases/api';
import { formatDateTime, formatDay } from '../../../features/purchases/format';
import type {
  CreditLedgerLine,
  CreditLot,
  PurchaseHistoryItem,
} from '../../../features/purchases/types';

const MINUS = '−';

/** +R$ 50,00 / −R$ 20,00 for the credit ledger. */
const signedBRL = (cents: number): string =>
  `${cents < 0 ? MINUS : '+'}${formatBRL(Math.abs(cents))}`;

const lotColumns: readonly TableColumn<CreditLot>[] = [
  { id: 'source', header: 'Origem', cell: (lot) => lot.label },
  { id: 'amount', header: 'Valor', align: 'right', cell: (lot) => formatBRL(lot.amountCents) },
  {
    id: 'remaining',
    header: 'Restante',
    align: 'right',
    cell: (lot) => formatBRL(lot.remainingCents),
  },
  { id: 'expires', header: 'Vence em', cell: (lot) => formatDay(lot.expiresAt) },
];

const ledgerColumns: readonly TableColumn<CreditLedgerLine>[] = [
  { id: 'at', header: 'Data', cell: (line) => formatDateTime(line.at) },
  { id: 'label', header: 'Lançamento', cell: (line) => line.label },
  { id: 'booking', header: 'Reserva', cell: (line) => line.bookingCode ?? '' },
  {
    id: 'amount',
    header: 'Valor',
    align: 'right',
    cell: (line) => (
      <span className="whitespace-nowrap font-semibold">{signedBRL(line.amountCents)}</span>
    ),
  },
];

/** `/app/compras/creditos`: available total, lots with source, remaining value and expiry, and the ledger (REC-114). */
export function CreditosPage() {
  const credits = useCredits();

  if (credits.isPending) {
    return (
      <div className="flex justify-center py-space-2xl">
        <Spinner label="Carregando créditos" />
      </div>
    );
  }
  if (credits.isError)
    return <Alert tone="error">Não foi possível carregar seus créditos agora.</Alert>;
  const { availableCents, lots, ledger } = credits.data;

  return (
    <div className="space-y-space-xl">
      <section aria-labelledby="credits-total" className="space-y-space-xs">
        <h2 id="credits-total" className="font-heading-mobile text-heading-mobile text-ink">
          Seus créditos
        </h2>
        <p className="font-h2 text-h2 font-semibold text-bronze">
          {`${formatBRL(availableCents)} disponíveis`}
        </p>
        <p className="font-small text-small text-ink-muted">
          Créditos são usados automaticamente se você marcar “Usar créditos” ao pagar uma reserva ou
          assinatura.
        </p>
      </section>
      <section aria-labelledby="credits-lots" className="space-y-space-sm">
        <h2 id="credits-lots" className="font-heading-mobile text-heading-mobile text-ink">
          Lotes de crédito
        </h2>
        <Table
          caption="Lotes de crédito"
          columns={lotColumns}
          rows={lots}
          rowKey={(lot) => lot.id}
          emptyMessage="Você não tem créditos no momento."
        />
      </section>
      <section aria-labelledby="credits-ledger" className="space-y-space-sm">
        <h2 id="credits-ledger" className="font-heading-mobile text-heading-mobile text-ink">
          Extrato de créditos
        </h2>
        <Table
          caption="Extrato de créditos"
          columns={ledgerColumns}
          rows={ledger}
          rowKey={(line) =>
            `${line.at}:${line.entryType}:${line.label}:${String(line.amountCents)}`
          }
          emptyMessage="Nenhum lançamento ainda."
        />
      </section>
    </div>
  );
}

const METHOD_LABELS: Record<PurchaseHistoryItem['method'], string> = {
  pix: 'Pix',
  card: 'Cartão',
  saved_card: 'Cartão salvo',
  credit: 'Créditos',
};

const historyColumns: readonly TableColumn<PurchaseHistoryItem>[] = [
  { id: 'at', header: 'Data', cell: (item) => formatDateTime(item.at) },
  { id: 'description', header: 'Descrição', cell: (item) => item.description },
  { id: 'method', header: 'Forma', cell: (item) => METHOD_LABELS[item.method] },
  {
    id: 'amount',
    header: 'Valor',
    align: 'right',
    cell: (item) => <span className="whitespace-nowrap">{formatBRL(item.amountCents)}</span>,
  },
  {
    id: 'status',
    header: 'Situação',
    cell: (item) => (
      <span className="flex flex-col">
        <span>{item.statusLabel}</span>
        {item.refundedCents > 0 ? (
          <span className="font-caption text-caption text-ink-muted">
            {`Reembolsado: ${formatBRL(item.refundedCents)}`}
          </span>
        ) : null}
      </span>
    ),
  },
];

/** `/app/compras/historico`: the tenant's charges, newest first, with method, status and refunds (REC-145). */
export function HistoricoPage() {
  const history = usePurchaseHistory();

  if (history.isPending) {
    return (
      <div className="flex justify-center py-space-2xl">
        <Spinner label="Carregando histórico" />
      </div>
    );
  }
  if (history.isError)
    return <Alert tone="error">Não foi possível carregar o histórico agora.</Alert>;
  const items = history.data.pages.flatMap((page) => page.items);

  return (
    <section aria-labelledby="history-title" className="space-y-space-md">
      <h2 id="history-title" className="font-heading-mobile text-heading-mobile text-ink">
        Histórico de compras
      </h2>
      <Table
        caption="Histórico de compras"
        columns={historyColumns}
        rows={items}
        rowKey={(item) => item.chargeId}
        emptyMessage="Você ainda não fez compras."
      />
      {history.hasNextPage ? (
        <Button
          variant="secondary"
          loading={history.isFetchingNextPage}
          onClick={() => void history.fetchNextPage()}
        >
          Carregar mais
        </Button>
      ) : null}
    </section>
  );
}
