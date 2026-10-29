import { formatBRL, type LocalDate } from '@bravo/core';
import { useState } from 'react';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Alert, Spinner } from '../../../components/ui/Feedback';
import { Input, Select } from '../../../components/ui/form';
import { Modal } from '../../../components/ui/Modal';
import { Table, type TableColumn } from '../../../components/ui/Table';
import { useToast } from '../../../components/ui/Toast';
import {
  expenseAttachmentUrl,
  useDeleteExpense,
  useExpenseCategories,
  useExpenses,
} from '../../../features/admin-finance/api';
import { CategoriesDrawer } from '../../../features/admin-finance/CategoriesDrawer';
import type { Expense } from '../../../features/admin-finance/contracts';
import { ExpenseFormModal } from '../../../features/admin-finance/ExpenseFormModal';
import { RECURRENCE_LABELS } from '../../../features/admin-finance/labels';
import { monthRange, todayLocal } from '../../../features/admin-finance/period';
import { messageOf } from '../../../lib/api-errors';
import { formatLocalDateBR } from '../../../lib/format';

function DeleteExpenseModal({ expense, onClose }: { expense: Expense; onClose: () => void }) {
  const remove = useDeleteExpense();
  const { toast } = useToast();
  const [error, setError] = useState<string | null>(null);

  return (
    <Modal open onClose={onClose} title="Excluir despesa">
      <p className="font-body text-body text-ink">
        Excluir <span className="font-medium">{expense.description}</span> de{' '}
        {formatLocalDateBR(expense.date)} ({formatBRL(expense.amountCents)})? Ela deixa de entrar
        nos relatórios.
      </p>
      {error ? (
        <Alert tone="error" className="mt-space-md">
          {error}
        </Alert>
      ) : null}
      <div className="mt-space-lg flex flex-wrap justify-end gap-space-sm">
        <Button variant="secondary" onClick={onClose}>
          Cancelar
        </Button>
        <Button
          className="text-danger"
          variant="secondary"
          loading={remove.isPending}
          onClick={() => {
            setError(null);
            remove.mutate(expense.id, {
              onSuccess: () => {
                toast({ message: 'Despesa excluída.' });
                onClose();
              },
              onError: (failure) => {
                setError(messageOf(failure, 'Não foi possível excluir a despesa.'));
              },
            });
          }}
        >
          Excluir despesa
        </Button>
      </div>
    </Modal>
  );
}

export interface ExpensesTabProps {
  /** Clinic-local date for the default window; the real date unless a test injects one. */
  today?: LocalDate;
}

/** Despesas tab: filtered list, create/edit form with recurrence and attachment, categories (GES-11..GES-19). */
export function ExpensesTab({ today }: ExpensesTabProps) {
  const now = today ?? todayLocal();
  const initial = monthRange(now);
  const [from, setFrom] = useState<string>(initial.from);
  const [to, setTo] = useState<string>(initial.to);
  const [categoryId, setCategoryId] = useState('');
  const [formTarget, setFormTarget] = useState<Expense | 'new' | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Expense | null>(null);
  const [categoriesOpen, setCategoriesOpen] = useState(false);

  const categories = useExpenseCategories();
  const expenses = useExpenses({ from, to, ...(categoryId ? { categoryId } : {}) });
  const rows = expenses.data?.pages.flatMap((page) => page.items) ?? [];

  const columns: readonly TableColumn<Expense>[] = [
    {
      id: 'date',
      header: 'Data',
      sortValue: (e) => e.date,
      cell: (e) => formatLocalDateBR(e.date),
    },
    { id: 'category', header: 'Categoria', cell: (e) => e.categoryName },
    {
      id: 'description',
      header: 'Descrição',
      cell: (e) => (
        <span className="flex flex-wrap items-center gap-space-xs">
          {e.description}
          {e.recurrence !== 'none' ? <Badge>{RECURRENCE_LABELS[e.recurrence]}</Badge> : null}
          {e.recurrenceParentId ? <Badge tone="neutral">Automática</Badge> : null}
        </span>
      ),
    },
    {
      id: 'amount',
      header: 'Valor',
      align: 'right',
      sortValue: (e) => e.amountCents,
      cell: (e) => formatBRL(e.amountCents),
    },
    {
      id: 'attachment',
      header: 'Anexo',
      cell: (e) =>
        e.attachmentName ? (
          <a
            href={expenseAttachmentUrl(e.id)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Ver anexo de ${e.description}`}
            className="text-accent underline underline-offset-4"
          >
            {e.attachmentName}
          </a>
        ) : (
          '—'
        ),
    },
    {
      id: 'actions',
      header: 'Ações',
      cell: (e) => (
        <div className="flex flex-wrap gap-space-xs">
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Editar ${e.description}`}
            onClick={() => {
              setFormTarget(e);
            }}
          >
            Editar
          </Button>
          <Button
            className="text-danger"
            variant="ghost"
            size="sm"
            aria-label={`Excluir ${e.description}`}
            onClick={() => {
              setDeleteTarget(e);
            }}
          >
            Excluir
          </Button>
        </div>
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
        <Select
          label="Categoria"
          value={categoryId}
          onChange={(event) => {
            setCategoryId(event.target.value);
          }}
        >
          <option value="">Todas</option>
          {(categories.data?.items ?? []).map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </Select>
        <div className="ml-auto flex flex-wrap gap-space-sm">
          <Button
            variant="secondary"
            onClick={() => {
              setCategoriesOpen(true);
            }}
          >
            Categorias
          </Button>
          <Button
            onClick={() => {
              setFormTarget('new');
            }}
          >
            Nova despesa
          </Button>
        </div>
      </div>

      {expenses.isPending ? <Spinner label="Carregando as despesas" /> : null}
      {expenses.isError ? (
        <Alert tone="error">
          <p>{messageOf(expenses.error, 'Não foi possível carregar as despesas.')}</p>
          <Button
            variant="secondary"
            size="sm"
            className="mt-space-sm"
            onClick={() => {
              void expenses.refetch();
            }}
          >
            Tentar novamente
          </Button>
        </Alert>
      ) : null}
      {expenses.data ? (
        <Table
          density="compact"
          caption="Despesas do período"
          columns={columns}
          rows={rows}
          rowKey={(e) => e.id}
          defaultSort={{ columnId: 'date', direction: 'desc' }}
          emptyMessage="Nenhuma despesa no período."
        />
      ) : null}
      {expenses.hasNextPage ? (
        <Button
          variant="secondary"
          loading={expenses.isFetchingNextPage}
          onClick={() => {
            void expenses.fetchNextPage();
          }}
        >
          Carregar mais
        </Button>
      ) : null}

      {formTarget !== null ? (
        <ExpenseFormModal
          expense={formTarget === 'new' ? null : formTarget}
          categories={categories.data?.items ?? []}
          today={now}
          onClose={() => {
            setFormTarget(null);
          }}
        />
      ) : null}
      {deleteTarget ? (
        <DeleteExpenseModal
          expense={deleteTarget}
          onClose={() => {
            setDeleteTarget(null);
          }}
        />
      ) : null}
      <CategoriesDrawer
        open={categoriesOpen}
        onClose={() => {
          setCategoriesOpen(false);
        }}
      />
    </div>
  );
}
