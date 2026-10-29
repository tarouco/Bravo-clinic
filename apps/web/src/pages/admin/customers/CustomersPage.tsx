import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../../components/ui/Button';
import { Alert, Spinner } from '../../../components/ui/Feedback';
import { Input } from '../../../components/ui/form';
import { Table, type TableColumn } from '../../../components/ui/Table';
import { useCustomers } from '../../../features/admin-customers/api';
import type { CustomerSummary } from '../../../features/admin-customers/contracts';
import { formatPhone } from '../../../features/admin-customers/format';
import { messageOf } from '../../../lib/api-errors';
import { usePageTitle } from '../../../lib/usePageTitle';

/** Pause after the last keystroke before the search request goes out. */
export const SEARCH_DEBOUNCE_MS = 300;

const columns: readonly TableColumn<CustomerSummary>[] = [
  {
    id: 'name',
    header: 'Nome',
    sortValue: (c) => c.name,
    cell: (c) => (
      <Link
        to={`/admin/clientes/${c.id}`}
        className="font-medium text-accent underline underline-offset-4"
      >
        {c.name}
      </Link>
    ),
  },
  { id: 'email', header: 'E-mail', cell: (c) => c.email },
  { id: 'phone', header: 'Telefone', cell: (c) => formatPhone(c.phone) },
  { id: 'doc', header: 'Documento', cell: (c) => c.docMasked ?? '—' },
];

/** `/admin/clientes`: search by name, e-mail, document or phone, 50 per page (GES-99). */
export function CustomersPage() {
  usePageTitle('Clientes');
  const [term, setTerm] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(term.trim());
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [term]);

  const customers = useCustomers(query);
  const rows = customers.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-space-lg">
      <h1 className="font-display-l-mobile text-display-l-mobile text-ink lg:font-display-l lg:text-display-l">
        Clientes
      </h1>
      <Input
        label="Buscar cliente"
        type="search"
        value={term}
        help="Nome, e-mail, CPF/CNPJ ou telefone."
        onChange={(event) => {
          setTerm(event.target.value);
        }}
      />

      {customers.isPending ? <Spinner label="Carregando os clientes" /> : null}
      {customers.isError ? (
        <Alert tone="error">
          <p>{messageOf(customers.error, 'Não foi possível carregar os clientes.')}</p>
          <Button
            variant="secondary"
            size="sm"
            className="mt-space-sm"
            onClick={() => {
              void customers.refetch();
            }}
          >
            Tentar novamente
          </Button>
        </Alert>
      ) : null}
      {customers.data ? (
        <Table
          density="compact"
          caption="Clientes"
          columns={columns}
          rows={rows}
          rowKey={(c) => c.id}
          emptyMessage={
            query === ''
              ? 'Nenhum cliente cadastrado.'
              : `Nenhum cliente encontrado para "${query}".`
          }
        />
      ) : null}
      {customers.hasNextPage ? (
        <Button
          variant="secondary"
          loading={customers.isFetchingNextPage}
          onClick={() => {
            void customers.fetchNextPage();
          }}
        >
          Carregar mais
        </Button>
      ) : null}
    </div>
  );
}
