import { deleteWithJustificationSchema, staffUserInputSchema } from '@bravo/core';
import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Alert } from '../../components/ui/Feedback';
import { Input, Select, Textarea } from '../../components/ui/form';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/Toast';
import { ApiError } from '../../lib/api';
import { fieldErrorsOf, messageOf } from '../../lib/api-errors';
import { useInviteStaff, useResetTotp, useUpdateStaffUser } from './api';
import type { StaffUser } from './contracts';
import { LAST_ADMIN_MESSAGE, STAFF_ROLE_LABELS } from './labels';

/** The message of a failed role/status change: `LAST_ADMIN` has its own fixed text. */
function changeMessage(error: Error): string {
  if (error instanceof ApiError && error.code === 'LAST_ADMIN') return LAST_ADMIN_MESSAGE;
  return messageOf(error, 'Não foi possível salvar a alteração.');
}

export type StaffChange = 'role' | 'disable' | 'enable';

export interface ChangeDialogProps {
  user: StaffUser;
  change: StaffChange;
  onClose: () => void;
}

const CHANGE_COPY: Record<StaffChange, { title: string; confirm: string }> = {
  role: { title: 'Alterar perfil', confirm: 'Confirmar alteração' },
  disable: { title: 'Desativar usuário', confirm: 'Desativar usuário' },
  enable: { title: 'Reativar usuário', confirm: 'Reativar usuário' },
};

/** Confirmation of a role change, disabling or reactivating; it ends all of the user's sessions. */
export function ChangeDialog({ user, change, onClose }: ChangeDialogProps) {
  const update = useUpdateStaffUser();
  const { toast } = useToast();
  const [error, setError] = useState<string | null>(null);
  const copy = CHANGE_COPY[change];
  const newRole: StaffUser['role'] = user.role === 'admin' ? 'reception' : 'admin';

  const body =
    change === 'role'
      ? { role: newRole }
      : { status: change === 'disable' ? ('disabled' as const) : ('active' as const) };

  return (
    <Modal open onClose={onClose} title={copy.title}>
      <div className="space-y-space-md">
        <p className="font-body text-body text-ink">
          {change === 'role'
            ? `${user.name} passa a ser ${STAFF_ROLE_LABELS[newRole]}.`
            : change === 'disable'
              ? `${user.name} deixa de entrar no painel.`
              : `${user.name} volta a entrar no painel.`}{' '}
          As sessões abertas dessa pessoa são encerradas e a alteração fica na auditoria.
        </p>
        {error ? <Alert tone="error">{error}</Alert> : null}
        <div className="flex flex-wrap justify-end gap-space-sm">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            loading={update.isPending}
            onClick={() => {
              setError(null);
              update.mutate(
                { id: user.id, body },
                {
                  onSuccess: () => {
                    toast({ message: 'Usuário atualizado.' });
                    onClose();
                  },
                  onError: (failure) => {
                    setError(changeMessage(failure));
                  },
                },
              );
            }}
          >
            {copy.confirm}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** 2FA reset of another staff user, with a justification of 5..500 characters (GES-114). */
export function ResetTotpDialog({ user, onClose }: { user: StaffUser; onClose: () => void }) {
  const reset = useResetTotp();
  const { toast } = useToast();
  const [justification, setJustification] = useState('');
  const [error, setError] = useState<string | null>(null);
  const check = deleteWithJustificationSchema.safeParse({ justification });

  return (
    <Modal open onClose={onClose} title="Redefinir 2FA">
      <form
        className="space-y-space-md"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!check.success) return;
          setError(null);
          reset.mutate(
            { id: user.id, justification: check.data.justification },
            {
              onSuccess: () => {
                toast({ message: 'Verificação em duas etapas redefinida.' });
                onClose();
              },
              onError: (failure) => {
                setError(messageOf(failure, 'Não foi possível redefinir o 2FA.'));
              },
            },
          );
        }}
      >
        <p className="font-body text-body text-ink">
          {user.name} perde a verificação em duas etapas, as sessões abertas são encerradas e no
          próximo acesso será preciso configurá-la de novo.
        </p>
        <Textarea
          label="Justificativa"
          rows={3}
          maxLength={500}
          value={justification}
          error={
            justification.length > 0 && !check.success ? check.error.issues[0]?.message : undefined
          }
          help="Entre 5 e 500 caracteres. Fica registrada na auditoria."
          onChange={(event) => {
            setJustification(event.target.value);
          }}
        />
        {error ? <Alert tone="error">{error}</Alert> : null}
        <div className="flex flex-wrap justify-end gap-space-sm">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={!check.success} loading={reset.isPending}>
            Redefinir 2FA
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Invite a new e-mail as staff, or promote an existing customer (GES-111). */
export function InviteDialog({ onClose }: { onClose: () => void }) {
  const invite = useInviteStaff();
  const { toast } = useToast();
  const [form, setForm] = useState({ name: '', email: '', role: 'reception' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const submit = () => {
    setFormError(null);
    const parsed = staffUserInputSchema.safeParse(form);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? 'form');
        if (!(key in next)) next[key] = issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    invite.mutate(parsed.data, {
      onSuccess: () => {
        toast({ message: 'Convite enviado.' });
        onClose();
      },
      onError: (failure) => {
        const fields = fieldErrorsOf(failure);
        if (Object.keys(fields).length > 0) setErrors(fields);
        else setFormError(messageOf(failure, 'Não foi possível adicionar o usuário.'));
      },
    });
  };

  return (
    <Modal open onClose={onClose} title="Adicionar usuário">
      <form
        className="space-y-space-md"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <p className="font-small text-small text-ink-muted">
          Um e-mail novo recebe um link de 72 horas para criar a senha. Se o e-mail for de um
          cliente, ele passa a ter o perfil escolhido.
        </p>
        <Input
          label="Nome"
          value={form.name}
          error={errors['name']}
          onChange={(event) => {
            setForm((current) => ({ ...current, name: event.target.value }));
          }}
        />
        <Input
          label="E-mail"
          type="email"
          value={form.email}
          error={errors['email']}
          onChange={(event) => {
            setForm((current) => ({ ...current, email: event.target.value }));
          }}
        />
        <Select
          label="Perfil"
          value={form.role}
          error={errors['role']}
          onChange={(event) => {
            setForm((current) => ({ ...current, role: event.target.value }));
          }}
        >
          <option value="reception">{STAFF_ROLE_LABELS.reception}</option>
          <option value="admin">{STAFF_ROLE_LABELS.admin}</option>
        </Select>
        {formError ? <Alert tone="error">{formError}</Alert> : null}
        <div className="flex flex-wrap justify-end gap-space-sm">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={invite.isPending}>
            Enviar convite
          </Button>
        </div>
      </form>
    </Modal>
  );
}
