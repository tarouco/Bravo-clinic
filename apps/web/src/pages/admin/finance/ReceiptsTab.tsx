import { deleteWithJustificationSchema, formatBRL, type LocalDate } from '@bravo/core';
import { useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { Alert, Spinner } from '../../../components/ui/Feedback';
import { Input, Textarea } from '../../../components/ui/form';
import { Modal } from '../../../components/ui/Modal';
import { Table, type TableColumn } from '../../../components/ui/Table';
import { useToast } from '../../../components/ui/Toast';
import { useDeleteReceipt, useReceipts } from '../../../features/admin-finance/api';
import type { ManualReceipt } from '../../../features/admin-finance/contracts';
import {
  RECEIPT_METHOD_LABELS,
  REVENUE_CATEGORY_LABELS,
} from '../../../features/admin-finance/labels';
import { monthRange, todayLocal } from '../../../features/admin-finance/period';
import { ReceiptFormModal } from '../../../features/admin-finance/ReceiptFormModal';
import { messageOf } from '../../../lib/api-errors';
import { formatLocalDateBR } from '../../../lib/format';

/** Deleting a receipt needs a justification of 5..500 characters (GES-21). */
function DeleteReceiptModal({ receipt, onClose }: { receipt: ManualReceipt; onClose: () => void }) {
  const remove = useDeleteReceipt();
  const { toast } = useToast();
  const [justification, setJustification] = useState('');
  const [error, setError] = useState<string | null>(null);
  const check = deleteWithJustificationSchema.safeParse({ justification });
  const valid = check.success;

  return (
    <Modal open onClose={onClose} title="Excluir recebimento">
      <form
        className="space-y-space-md"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!valid) return;
          setError(null);
          remove.mutate(
            { id: receipt.id, justification: justification.trim() },
            {
              onSuccess: () => {
                toast({ message: 'Recebimento excluído.' });
                onClose();
              },
              onError: (failure) => {
                setError(messageOf(failure, 'Não foi possível excluir o recebimento.'));
              },
            },
          );
        }}
      >
        <p className="font-body text-body text-ink">
          Excluir o recebimento de {formatBRL(receipt.amountCents)} de{' '}
          {formatLocalDateBR(receipt.date)}? Ele deixa de entrar nos relatórios e a exclusão fica
          registrada na auditoria.
        </p>
        <Textarea
          label="Justificativa"
          rows={3}
          maxLength={500}
          value={justification}
          error={
            justification.length > 0 && !check.success ? check.error.issues[0]?.message : undefined
          }
          help="Entre 5 e 500 caracteres."
          onChange={(event) => {
            setJustification(event.target.value);
          }}
        />
        {error ? <Alert tone="error">{error}</Alert> : null}
        <div className="flex flex-wrap justify-end gap-space-sm">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="danger" type="submit" disabled={!valid} loading={remove.isPending}>
            Excluir recebimento
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export interface ReceiptsTabProps {
  /** Clinic-local date for the default window; the real date unless a test injects one. */
  today?: LocalDate;
}

/** Recebimentos manuais tab: list, form and deletion with justification (GES-20, GES-21). */
export function ReceiptsTab({ today }: ReceiptsTabProps) {
  const now = today ?? todayLocal();
  const initial = monthRange(now);
  const [from, setFrom] = useState<string>(initial.from);
  const [to, setTo] = useState<string>(initial.to);
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ManualReceipt | null>(null);

  const receipts = useReceipts({ from, to });
  const rows = receipts.data?.pages.flatMap((page) => page.items) ?? [];

  const columns: readonly TableColumn<ManualReceipt>[] = [
    {
      id: 'date',
      header: 'Data',
      sortValue: (r) => r.date,
      cell: (r) => formatLocalDateBR(r.date),
    },
    {
      id: 'category',
      header: 'Categoria',
      cell: (r) => REVENUE_CATEGORY_LABELS[r.revenueCategory],
    },
    { id: 'method', header: 'Forma', cell: (r) => RECEIPT_METHOD_LABELS[r.method] },
    {
      id: 'amount',
      header: 'Valor',
      align: 'right',
      sortValue: (r) => r.amountCents,
      cell: (r) => formatBRL(r.amountCents),
    },
    { id: 'customer', header: 'Cliente', cell: (r) => r.customerName ?? '—' },
    { id: 'booking', header: 'Reserva', cell: (r) => r.bookingCode ?? '—' },
    { id: 'description', header: 'Descrição', cell: (r) => r.description ?? '—' },
    {
      id: 'actions',
      header: 'Ações',
      cell: (r) => (
        <Button
          className="text-danger"
          variant="ghost"
          size="sm"
          aria-label={`Excluir recebimento de ${formatBRL(r.amountCents)} em ${formatLocalDateBR(r.date)}`}
          onClick={() => {
            setDeleteTarget(r);
          }}
        >
          Excluir
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-space-md">
      <div className="flex flex-wrap items-end gap-space-md">
        <Input
          label="De"
          type="date"
          value={from}
          onChange={(event) => {
            if (event.target.value) setFrom(event.target.value);
          }}
        />
        <Input
          label="Até"
          type="date"
          value={to}
          onChange={(event) => {
            if (event.target.value) setTo(event.target.value);
          }}
        />
        <Button
          className="ml-auto"
          onClick={() => {
            setCreating(true);
          }}
        >
          Novo recebimento
        </Button>
      </div>

      {receipts.isPending ? <Spinner label="Carregando os recebimentos" /> : null}
      {receipts.isError ? (
        <Alert tone="error">
          <p>{messageOf(receipts.error, 'Não foi possível carregar os recebimentos.')}</p>
          <Button
            variant="secondary"
            size="sm"
            className="mt-space-sm"
            onClick={() => {
              void receipts.refetch();
            }}
          >
            Tentar novamente
          </Button>
        </Alert>
      ) : null}
      {receipts.data ? (
        <Table
          density="compact"
          caption="Recebimentos manuais do período"
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          defaultSort={{ columnId: 'date', direction: 'desc' }}
          emptyMessage="Nenhum recebimento manual no período."
        />
      ) : null}
      {receipts.hasNextPage ? (
        <Button
          variant="secondary"
          loading={receipts.isFetchingNextPage}
          onClick={() => {
            void receipts.fetchNextPage();
          }}
        >
          Carregar mais
        </Button>
      ) : null}

      {creating ? (
        <ReceiptFormModal
          today={now}
          onClose={() => {
            setCreating(false);
          }}
        />
      ) : null}
      {deleteTarget ? (
        <DeleteReceiptModal
          receipt={deleteTarget}
          onClose={() => {
            setDeleteTarget(null);
          }}
        />
      ) : null}
    </div>
  );
}
