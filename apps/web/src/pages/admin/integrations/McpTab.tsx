import { mcpTokenInputSchema } from '@bravo/core';
import { useId, useState, type ReactNode } from 'react';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { CopyField } from '../../../components/ui/CopyField';
import { Alert, Spinner } from '../../../components/ui/Feedback';
import { Checkbox, Input, Select } from '../../../components/ui/form';
import { Modal } from '../../../components/ui/Modal';
import { Table, type TableColumn } from '../../../components/ui/Table';
import { TokenList } from '../../../components/ui/TokenList';
import { useToast } from '../../../components/ui/Toast';
import {
  useIssueMcpToken,
  useMcp,
  useRevokeMcpToken,
  useSetMcpEnabled,
} from '../../../features/admin-integrations/api';
import type { McpTool } from '../../../features/admin-integrations/contracts';
import {
  MCP_TOKEN_SCOPE_LABELS,
  MCP_TOOL_SCOPE_LABELS,
} from '../../../features/admin-integrations/labels';
import { messageOf } from '../../../lib/api-errors';

const toolColumns: readonly TableColumn<McpTool>[] = [
  { id: 'name', header: 'Ferramenta', cell: (t) => <code className="font-mono">{t.name}</code> },
  { id: 'description', header: 'O que faz', cell: (t) => t.description },
  { id: 'scope', header: 'Escopo', cell: (t) => MCP_TOOL_SCOPE_LABELS[t.scope] },
  {
    id: 'destructive',
    header: 'Confirmação',
    cell: (t) => (t.destructive ? <Badge tone="danger">Requer confirmação</Badge> : '—'),
  },
];

/** Token creation: the form first, then the raw token, shown once (GES-53). */
function NewTokenModal({ onClose }: { onClose: () => void }) {
  const issue = useIssueMcpToken();
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'read' | 'read_write'>('read');
  const [days, setDays] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [rawToken, setRawToken] = useState<string | null>(null);

  const submit = () => {
    setFormError(null);
    const parsed = mcpTokenInputSchema.safeParse({
      name,
      scope,
      expiresInDays: days.trim() === '' ? undefined : Number(days),
    });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issueItem of parsed.error.issues) {
        const key = String(issueItem.path[0] ?? 'form');
        if (!(key in next)) next[key] = issueItem.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    issue.mutate(parsed.data, {
      onSuccess: (created) => {
        setRawToken(created.token);
      },
      onError: (failure) => {
        setFormError(messageOf(failure, 'Não foi possível criar o token.'));
      },
    });
  };

  return (
    <Modal open onClose={onClose} title="Novo token de acesso">
      {rawToken ? (
        <div className="space-y-space-md">
          <Alert tone="info">Copie agora: o token não será exibido de novo</Alert>
          <CopyField label="Token de acesso" value={rawToken} buttonLabel="Copiar token" />
          <div className="flex justify-end">
            <Button onClick={onClose}>Concluir</Button>
          </div>
        </div>
      ) : (
        <form
          className="space-y-space-md"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <Input
            label="Nome"
            value={name}
            maxLength={60}
            error={errors['name']}
            help="Ajuda a reconhecer onde o token é usado."
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
          <Select
            label="Escopo"
            value={scope}
            error={errors['scope']}
            onChange={(event) => {
              setScope(event.target.value as 'read' | 'read_write');
            }}
          >
            {(Object.keys(MCP_TOKEN_SCOPE_LABELS) as (keyof typeof MCP_TOKEN_SCOPE_LABELS)[]).map(
              (value) => (
                <option key={value} value={value}>
                  {MCP_TOKEN_SCOPE_LABELS[value]}
                </option>
              ),
            )}
          </Select>
          <Input
            label="Validade em dias (opcional)"
            inputMode="numeric"
            value={days}
            error={errors['expiresInDays']}
            help="De 1 a 365. Em branco, o token não expira."
            onChange={(event) => {
              setDays(event.target.value);
            }}
          />
          {formError ? <Alert tone="error">{formError}</Alert> : null}
          <div className="flex flex-wrap justify-end gap-space-sm">
            <Button variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" loading={issue.isPending}>
              Criar token
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="space-y-space-md rounded-lg bg-surface-raised shadow-card p-space-lg"
    >
      <div className="flex flex-wrap items-center justify-between gap-space-sm">
        <h2 id={headingId} className="font-heading text-heading-mobile text-ink">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** MCP tab: server switch and URL, tool catalog and access tokens (GES-53, GES-54, GES-63). */
export function McpTab() {
  const mcp = useMcp();
  const setEnabled = useSetMcpEnabled();
  const revoke = useRevokeMcpToken();
  const { toast } = useToast();
  const [creating, setCreating] = useState(false);

  if (mcp.isPending) return <Spinner label="Carregando o servidor MCP" />;
  if (mcp.isError) {
    return (
      <Alert tone="error">
        <p>{messageOf(mcp.error, 'Não foi possível carregar o servidor MCP.')}</p>
        <Button
          variant="secondary"
          size="sm"
          className="mt-space-sm"
          onClick={() => {
            void mcp.refetch();
          }}
        >
          Tentar novamente
        </Button>
      </Alert>
    );
  }

  const { enabled, serverUrl, serverUrlWarning, tools, tokens } = mcp.data;
  const shown =
    setEnabled.isPending && setEnabled.variables !== undefined ? setEnabled.variables : enabled;

  return (
    <div className="space-y-space-lg">
      <Section title="Servidor">
        <Checkbox
          label="Servidor MCP ativo"
          help="Desligado, o endereço responde como inexistente e nenhum token funciona."
          checked={shown}
          disabled={setEnabled.isPending}
          onChange={(event) => {
            setEnabled.mutate(event.target.checked, {
              onError: (error) => {
                toast({ message: messageOf(error, 'Não foi possível alterar o servidor MCP.') });
              },
            });
          }}
        />
        <CopyField label="URL do servidor MCP" value={serverUrl} buttonLabel="Copiar URL" />
        {serverUrlWarning ? <Alert tone="info">{serverUrlWarning}</Alert> : null}
      </Section>

      <Section title="Ferramentas disponíveis">
        <Table
          caption="Ferramentas do servidor MCP"
          columns={toolColumns}
          rows={tools}
          rowKey={(t) => t.name}
          emptyMessage="Nenhuma ferramenta registrada."
        />
      </Section>

      <Section
        title="Tokens de acesso"
        action={
          <Button
            size="sm"
            onClick={() => {
              setCreating(true);
            }}
          >
            Novo token
          </Button>
        }
      >
        <TokenList
          tokens={tokens}
          onRevoke={(id) => {
            revoke.mutate(id, {
              onSuccess: () => {
                toast({ message: 'Token revogado.' });
              },
              onError: (error) => {
                toast({ message: messageOf(error, 'Não foi possível revogar o token.') });
              },
            });
          }}
        />
      </Section>

      {creating ? (
        <NewTokenModal
          onClose={() => {
            setCreating(false);
          }}
        />
      ) : null}
    </div>
  );
}
