import { formatDateTimeBR } from '@bravo/core';
import { useState } from 'react';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Alert, Spinner } from '../../../components/ui/Feedback';
import { Table, type TableColumn } from '../../../components/ui/Table';
import { useStaffUsers } from '../../../features/admin-users/api';
import type { StaffUser } from '../../../features/admin-users/contracts';
import { STAFF_ROLE_LABELS, STAFF_STATUS_LABELS } from '../../../features/admin-users/labels';
import {
  ChangeDialog,
  InviteDialog,
  ResetTotpDialog,
  type StaffChange,
} from '../../../features/admin-users/StaffDialogs';
import { useSession } from '../../../features/auth/useSession';
import { messageOf } from '../../../lib/api-errors';
import { usePageTitle } from '../../../lib/usePageTitle';

type Dialog =
  | { kind: 'invite' }
  | { kind: 'change'; user: StaffUser; change: StaffChange }
  | { kind: 'totp'; user: StaffUser };

/**
 * `/admin/usuarios`: the staff accounts with their role, status and 2FA state, invitation or
 * promotion of a user, and the role, status and 2FA actions (GES-110..GES-114). An admin cannot
 * change the own account (GES-113): the actions of that row stay disabled.
 */
export function UsersPage() {
  usePageTitle('Usuários');
  const users = useStaffUsers();
  const { session } = useSession();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const close = () => {
    setDialog(null);
  };

  const columns: readonly TableColumn<StaffUser>[] = [
    {
      id: 'name',
      header: 'Nome',
      sortValue: (u) => u.name,
      cell: (u) => (
        <span className="font-medium">
          {u.name}
          {u.id === session?.id ? (
            <Badge tone="neutral" className="ml-space-xs">
              Você
            </Badge>
          ) : null}
        </span>
      ),
    },
    { id: 'email', header: 'E-mail', cell: (u) => u.email },
    { id: 'role', header: 'Perfil', cell: (u) => STAFF_ROLE_LABELS[u.role] },
    {
      id: 'status',
      header: 'Situação',
      cell: (u) => STAFF_STATUS_LABELS[u.status],
    },
    { id: 'totp', header: '2FA', cell: (u) => (u.totpConfirmed ? 'Ativa' : 'Pendente') },
    {
      id: 'lastLogin',
      header: 'Último acesso',
      cell: (u) => (u.lastLoginAt ? formatDateTimeBR(new Date(u.lastLoginAt)) : 'Nunca'),
    },
    {
      id: 'actions',
      header: 'Ações',
      cell: (u) => {
        const own = u.id === session?.id;
        // Until the session is known, no row is safe to change.
        const locked = own || session === null;
        const disabled = u.status === 'disabled';
        return (
          <span className="flex flex-wrap gap-space-xs">
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Alterar perfil de ${u.name}`}
              disabled={locked}
              onClick={() => {
                setDialog({ kind: 'change', user: u, change: 'role' });
              }}
            >
              Alterar perfil
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`${disabled ? 'Reativar' : 'Desativar'} ${u.name}`}
              disabled={locked}
              onClick={() => {
                setDialog({ kind: 'change', user: u, change: disabled ? 'enable' : 'disable' });
              }}
            >
              {disabled ? 'Reativar' : 'Desativar'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Redefinir 2FA de ${u.name}`}
              disabled={locked || !u.totpConfirmed}
              onClick={() => {
                setDialog({ kind: 'totp', user: u });
              }}
            >
              Redefinir 2FA
            </Button>
          </span>
        );
      },
    },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-space-lg">
      <div className="flex flex-wrap items-center justify-between gap-space-sm">
        <h1 className="font-display-l-mobile text-display-l-mobile text-ink lg:font-display-l lg:text-display-l">
          Usuários
        </h1>
        <Button
          onClick={() => {
            setDialog({ kind: 'invite' });
          }}
        >
          Adicionar usuário
        </Button>
      </div>

      {users.isPending ? <Spinner label="Carregando os usuários" /> : null}
      {users.isError ? (
        <Alert tone="error">
          <p>{messageOf(users.error, 'Não foi possível carregar os usuários.')}</p>
          <Button
            variant="secondary"
            size="sm"
            className="mt-space-sm"
            onClick={() => {
              void users.refetch();
            }}
          >
            Tentar novamente
          </Button>
        </Alert>
      ) : null}
      {users.data ? (
        <Table
          caption="Usuários da equipe"
          columns={columns}
          rows={users.data.items}
          rowKey={(u) => u.id}
          defaultSort={{ columnId: 'name', direction: 'asc' }}
          emptyMessage="Nenhum usuário da equipe."
        />
      ) : null}

      {dialog?.kind === 'invite' ? <InviteDialog onClose={close} /> : null}
      {dialog?.kind === 'change' ? (
        <ChangeDialog user={dialog.user} change={dialog.change} onClose={close} />
      ) : null}
      {dialog?.kind === 'totp' ? <ResetTotpDialog user={dialog.user} onClose={close} /> : null}
    </div>
  );
}
