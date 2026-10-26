import { formatDateBR } from '@bravo/core';
import { useState } from 'react';
import { Button } from './Button';
import { Modal } from './Modal';
import { Table, type TableColumn } from './Table';

/** Token as listed by `GET /admin/integrations/mcp` (gestao design "Data Models"); no secret. */
export interface McpTokenView {
  id: string;
  name: string;
  scope: 'read' | 'read_write';
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
}

export interface TokenListProps {
  tokens: readonly McpTokenView[];
  /** Called after the admin confirms the revocation in the dialog. */
  onRevoke: (id: string) => void;
  emptyMessage?: string;
}

const SCOPE_LABEL: Record<McpTokenView['scope'], string> = {
  read: 'Leitura',
  read_write: 'Leitura e escrita',
};

const dateOf = (iso: string | null): string => (iso ? formatDateBR(new Date(iso)) : '—');

function statusOf(token: McpTokenView, now: number): string {
  if (token.revokedAt) return 'Revogado';
  if (token.expiresAt && new Date(token.expiresAt).getTime() <= now) return 'Expirado';
  return 'Ativo';
}

/** Tokens with their prefix, scope and dates; revoking needs a confirmation (GES-60). */
export function TokenList({
  tokens,
  onRevoke,
  emptyMessage = 'Nenhum token emitido.',
}: TokenListProps) {
  const [target, setTarget] = useState<McpTokenView | null>(null);
  const now = Date.now();

  const columns: readonly TableColumn<McpTokenView>[] = [
    { id: 'name', header: 'Nome', cell: (t) => <span className="font-medium">{t.name}</span> },
    {
      id: 'prefix',
      header: 'Prefixo',
      cell: (t) => <code className="font-mono">{t.prefix}…</code>,
    },
    { id: 'scope', header: 'Escopo', cell: (t) => SCOPE_LABEL[t.scope] },
    { id: 'created', header: 'Criado em', cell: (t) => dateOf(t.createdAt) },
    { id: 'used', header: 'Último uso', cell: (t) => dateOf(t.lastUsedAt) },
    { id: 'expires', header: 'Expira em', cell: (t) => dateOf(t.expiresAt) },
    { id: 'status', header: 'Situação', cell: (t) => statusOf(t, now) },
    {
      id: 'actions',
      header: 'Ações',
      cell: (t) =>
        t.revokedAt ? null : (
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Revogar token ${t.name}`}
            onClick={() => {
              setTarget(t);
            }}
          >
            Revogar
          </Button>
        ),
    },
  ];

  return (
    <>
      <Table
        caption="Tokens de acesso"
        columns={columns}
        rows={tokens}
        rowKey={(t) => t.id}
        emptyMessage={emptyMessage}
      />
      <Modal
        open={target !== null}
        onClose={() => {
          setTarget(null);
        }}
        title="Revogar token"
      >
        <p className="font-body text-body text-ink">
          O token <span className="font-medium">{target?.name}</span> deixa de funcionar na hora e
          não pode ser reativado. Quem o usa precisará de um token novo.
        </p>
        <div className="mt-space-lg flex flex-wrap justify-end gap-space-sm">
          <Button
            variant="secondary"
            onClick={() => {
              setTarget(null);
            }}
          >
            Cancelar
          </Button>
          <Button
            onClick={() => {
              if (target) onRevoke(target.id);
              setTarget(null);
            }}
          >
            Revogar token
          </Button>
        </div>
      </Modal>
    </>
  );
}
