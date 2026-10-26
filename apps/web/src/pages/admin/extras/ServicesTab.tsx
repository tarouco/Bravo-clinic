import { useState } from 'react';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Alert, Spinner } from '../../../components/ui/Feedback';
import { Table, type TableColumn } from '../../../components/ui/Table';
import { useExtraServices } from '../../../features/admin-extras/api';
import type { ExtraService } from '../../../features/admin-extras/contracts';
import {
  formatServicePrice,
  SALE_MODE_LABELS,
  UNIT_LABELS,
} from '../../../features/admin-extras/labels';
import { ServiceFormModal } from '../../../features/admin-extras/ServiceFormModal';
import { messageOf } from '../../../lib/api-errors';

/** Serviços tab: the catalog with create and edit (GES-84, GES-85). */
export function ServicesTab() {
  const services = useExtraServices();
  const [editing, setEditing] = useState<ExtraService | 'new' | null>(null);
  const items = services.data?.items ?? [];

  const columns: readonly TableColumn<ExtraService>[] = [
    { id: 'name', header: 'Serviço', sortValue: (s) => s.name, cell: (s) => s.name },
    {
      id: 'price',
      header: 'Preço de referência',
      cell: (s) => formatServicePrice(s.referencePriceCents, s.unit),
    },
    { id: 'unit', header: 'Unidade', cell: (s) => UNIT_LABELS[s.unit] },
    { id: 'saleMode', header: 'Venda', cell: (s) => SALE_MODE_LABELS[s.saleMode] },
    {
      id: 'status',
      header: 'Situação',
      cell: (s) => (
        <Badge tone={s.status === 'active' ? 'bronze' : 'neutral'}>
          {s.status === 'active' ? 'Ativo' : 'Inativo'}
        </Badge>
      ),
    },
    {
      id: 'order',
      header: 'Ordem',
      align: 'right',
      sortValue: (s) => s.displayOrder,
      cell: (s) => String(s.displayOrder),
    },
    {
      id: 'actions',
      header: 'Ações',
      cell: (s) => (
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Editar ${s.name}`}
          onClick={() => {
            setEditing(s);
          }}
        >
          Editar
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-space-md">
      <div className="flex justify-end">
        <Button
          onClick={() => {
            setEditing('new');
          }}
        >
          Novo serviço
        </Button>
      </div>

      {services.isPending ? <Spinner label="Carregando os serviços" /> : null}
      {services.isError ? (
        <Alert tone="error">
          <p>{messageOf(services.error, 'Não foi possível carregar os serviços.')}</p>
          <Button
            variant="secondary"
            size="sm"
            className="mt-space-sm"
            onClick={() => {
              void services.refetch();
            }}
          >
            Tentar novamente
          </Button>
        </Alert>
      ) : null}
      {services.data ? (
        <Table
          caption="Serviços extras"
          columns={columns}
          rows={items}
          rowKey={(s) => s.id}
          defaultSort={{ columnId: 'order', direction: 'asc' }}
          emptyMessage="Nenhum serviço cadastrado."
        />
      ) : null}

      {editing ? (
        <ServiceFormModal
          service={editing === 'new' ? null : editing}
          nextOrder={items.reduce((max, s) => Math.max(max, s.displayOrder), 0) + 1}
          onClose={() => {
            setEditing(null);
          }}
        />
      ) : null}
    </div>
  );
}
