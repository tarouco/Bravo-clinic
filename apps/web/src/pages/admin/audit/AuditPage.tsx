import { auditOriginSchema, formatDateTimeBR } from '@bravo/core';
import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '../../../components/ui/Button';
import { Drawer } from '../../../components/ui/Drawer';
import { Alert, Spinner } from '../../../components/ui/Feedback';
import { Input, Select } from '../../../components/ui/form';
import { Table, type TableColumn } from '../../../components/ui/Table';
import { EMPTY_FILTERS, useAudit, type AuditFilters } from '../../../features/admin-audit/api';
import type { AuditRow } from '../../../features/admin-audit/contracts';
import { AUDIT_ORIGIN_LABELS } from '../../../features/admin-audit/labels';
import { useStaffUsers } from '../../../features/admin-users/api';
import { STAFF_ROLE_LABELS } from '../../../features/admin-users/labels';
import { messageOf } from '../../../lib/api-errors';
import { usePageTitle } from '../../../lib/usePageTitle';

const FILTER_KEYS = Object.keys(EMPTY_FILTERS) as (keyof AuditFilters)[];

/** The filters in the URL; an unknown origin is dropped. */
function filtersFrom(params: URLSearchParams): AuditFilters {
  const filters = { ...EMPTY_FILTERS };
  for (const key of FILTER_KEYS) filters[key] = params.get(key) ?? '';
  if (!auditOriginSchema.safeParse(filters.origin).success) filters.origin = '';
  return filters;
}

const entityOf = (row: AuditRow): string =>
  row.entityId ? `${row.entityType} ${row.entityId}` : row.entityType;

const roleOf = (role: string | null): string | null =>
  role === 'admin' || role === 'reception' ? STAFF_ROLE_LABELS[role] : role;

function actorOf(row: AuditRow): string {
  if (!row.actorName) return '—';
  const role = roleOf(row.actorRole);
  return role ? `${row.actorName} (${role})` : row.actorName;
}

const jsonOf = (value: unknown): string =>
  value === null || value === undefined ? '—' : JSON.stringify(value, null, 2);

function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="font-caption text-caption uppercase tracking-[0.08em] text-ink-muted">
        {term}
      </dt>
      <dd className="break-words font-small text-small text-ink">{children}</dd>
    </div>
  );
}

function DetailDrawer({ row, onClose }: { row: AuditRow; onClose: () => void }) {
  return (
    <Drawer open onClose={onClose} title="Registro de auditoria" wide>
      <dl className="space-y-space-sm">
        <Row term="Data">{formatDateTimeBR(new Date(row.at))}</Row>
        <Row term="Usuário">{actorOf(row)}</Row>
        <Row term="Origem">{AUDIT_ORIGIN_LABELS[row.origin]}</Row>
        <Row term="Ação">{row.action}</Row>
        <Row term="Entidade">{entityOf(row)}</Row>
        <Row term="Justificativa">{row.justification ?? '—'}</Row>
      </dl>
      <div className="mt-space-md grid gap-space-md md:grid-cols-2">
        {[
          ['Antes', row.before],
          ['Depois', row.after],
        ].map(([label, value]) => (
          <div key={String(label)}>
            <p className="mb-space-xs font-caption text-caption uppercase tracking-[0.08em] text-ink-muted">
              {String(label)}
            </p>
            <pre
              aria-label={String(label)}
              className="max-h-96 overflow-auto rounded-control bg-surface-stone p-space-sm font-mono text-caption text-ink"
            >
              {jsonOf(value)}
            </pre>
          </div>
        ))}
      </div>
    </Drawer>
  );
}

/**
 * `/admin/auditoria`: the audit trail with filters and a detail drawer (GES-115, GES-116). The
 * filters live in the URL; the form applies them on "Filtrar".
 */
export function AuditPage() {
  usePageTitle('Log de auditoria');
  const [searchParams, setSearchParams] = useSearchParams();
  const applied = filtersFrom(searchParams);
  const [draft, setDraft] = useState<AuditFilters>(applied);
  const [opened, setOpened] = useState<AuditRow | null>(null);
  const audit = useAudit(applied);
  const users = useStaffUsers();
  const rows = audit.data?.pages.flatMap((page) => page.items) ?? [];

  const setField = (key: keyof AuditFilters, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const apply = (filters: AuditFilters) => {
    const next = new URLSearchParams();
    for (const key of FILTER_KEYS) {
      if (filters[key] !== '') next.set(key, filters[key]);
    }
    setSearchParams(next);
  };

  const columns: readonly TableColumn<AuditRow>[] = [
    { id: 'at', header: 'Data', cell: (r) => formatDateTimeBR(new Date(r.at)) },
    { id: 'actor', header: 'Usuário', cell: (r) => r.actorName ?? '—' },
    { id: 'origin', header: 'Origem', cell: (r) => AUDIT_ORIGIN_LABELS[r.origin] },
    { id: 'action', header: 'Ação', cell: (r) => r.action },
    { id: 'entity', header: 'Entidade', cell: (r) => entityOf(r) },
    {
      id: 'details',
      header: 'Detalhes',
      cell: (r) => (
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Detalhes de ${r.action}`}
          onClick={() => {
            setOpened(r);
          }}
        >
          Detalhes
        </Button>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-space-lg">
      <h1 className="font-heading text-heading-mobile text-ink md:text-heading">
        Log de auditoria
      </h1>

      <form
        noValidate
        aria-label="Filtros da auditoria"
        className="grid gap-space-md rounded-card border border-hairline bg-surface-raised p-space-md sm:grid-cols-2 lg:grid-cols-4"
        onSubmit={(event) => {
          event.preventDefault();
          apply(draft);
        }}
      >
        <Select
          label="Usuário"
          value={draft.actorId}
          onChange={(event) => {
            setField('actorId', event.target.value);
          }}
        >
          <option value="">Todos</option>
          {users.data?.items.map((user) => (
            <option key={user.id} value={user.id}>
              {user.name}
            </option>
          ))}
        </Select>
        <Select
          label="Origem"
          value={draft.origin}
          onChange={(event) => {
            setField('origin', event.target.value);
          }}
        >
          <option value="">Todas</option>
          {(Object.keys(AUDIT_ORIGIN_LABELS) as (keyof typeof AUDIT_ORIGIN_LABELS)[]).map(
            (origin) => (
              <option key={origin} value={origin}>
                {AUDIT_ORIGIN_LABELS[origin]}
              </option>
            ),
          )}
        </Select>
        <Input
          label="Ação começa com"
          value={draft.actionPrefix}
          onChange={(event) => {
            setField('actionPrefix', event.target.value);
          }}
        />
        <Input
          label="Tipo de entidade"
          value={draft.entityType}
          onChange={(event) => {
            setField('entityType', event.target.value);
          }}
        />
        <Input
          label="ID da entidade"
          value={draft.entityId}
          onChange={(event) => {
            setField('entityId', event.target.value);
          }}
        />
        <Input
          label="De"
          type="date"
          value={draft.from}
          onChange={(event) => {
            setField('from', event.target.value);
          }}
        />
        <Input
          label="Até"
          type="date"
          value={draft.to}
          onChange={(event) => {
            setField('to', event.target.value);
          }}
        />
        <div className="flex items-end gap-space-sm">
          <Button type="submit">Filtrar</Button>
          <Button
            variant="secondary"
            onClick={() => {
              setDraft(EMPTY_FILTERS);
              apply(EMPTY_FILTERS);
            }}
          >
            Limpar filtros
          </Button>
        </div>
      </form>

      {audit.isPending ? <Spinner label="Carregando a auditoria" /> : null}
      {audit.isError ? (
        <Alert tone="error">
          <p>{messageOf(audit.error, 'Não foi possível carregar a auditoria.')}</p>
          <Button
            variant="secondary"
            size="sm"
            className="mt-space-sm"
            onClick={() => {
              void audit.refetch();
            }}
          >
            Tentar novamente
          </Button>
        </Alert>
      ) : null}
      {audit.data ? (
        <Table
          caption="Registros de auditoria"
          columns={columns}
          rows={rows}
          rowKey={(r) => String(r.id)}
          emptyMessage="Nenhum registro para os filtros escolhidos."
        />
      ) : null}
      {audit.hasNextPage ? (
        <Button
          variant="secondary"
          loading={audit.isFetchingNextPage}
          onClick={() => {
            void audit.fetchNextPage();
          }}
        >
          Carregar mais
        </Button>
      ) : null}

      {opened ? (
        <DetailDrawer
          row={opened}
          onClose={() => {
            setOpened(null);
          }}
        />
      ) : null}
    </div>
  );
}
