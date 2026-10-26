import { deletionConfirmSchema } from '@bravo/core';
import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Alert } from '../../components/ui/Feedback';
import { Checkbox, Input, PasswordInput } from '../../components/ui/form';
import { Modal } from '../../components/ui/Modal';
import { ApiError } from '../../lib/api';
import { messageOf } from '../../lib/api-errors';
import { commitmentsOf, type Commitments } from '../../lib/commitments';
import { useDeleteAccount } from './api';

/** The text a Google-only account types instead of a password (GES-124). */
export const CONFIRM_TEXT = 'EXCLUIR';

export interface DeleteAccountModalProps {
  onClose: () => void;
  /** Called after the API anonymized the account and ended the session. */
  onDone: () => void;
}

/**
 * Confirmation of "Excluir minha conta" (GES-124..GES-126, GES-128): says what is erased and what
 * is kept, asks for the current password (or `EXCLUIR` for Google-only accounts) and lists the
 * open bookings and subscriptions that block the deletion (409).
 */
export function DeleteAccountModal({ onClose, onDone }: DeleteAccountModalProps) {
  const remove = useDeleteAccount();
  const [googleOnly, setGoogleOnly] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<Commitments | null>(null);

  const ready = googleOnly ? confirmText.trim() === CONFIRM_TEXT : password.length > 0;

  const submit = () => {
    const parsed = deletionConfirmSchema.safeParse(
      googleOnly ? { confirmText: confirmText.trim() } : { password },
    );
    if (!parsed.success) return;
    setError(null);
    setBlockers(null);
    remove.mutate(parsed.data, {
      onSuccess: onDone,
      onError: (failure) => {
        const commitments = commitmentsOf(failure);
        if (commitments) setBlockers(commitments);
        if (failure instanceof ApiError && failure.status === 401) {
          setError(
            googleOnly
              ? `O texto não confere. Digite ${CONFIRM_TEXT} em maiúsculas.`
              : 'Senha incorreta. Tente novamente.',
          );
          return;
        }
        setError(messageOf(failure, 'Não foi possível excluir a conta agora.'));
      },
    });
  };

  return (
    <Modal open onClose={onClose} title="Excluir minha conta">
      <form
        className="space-y-space-md"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) submit();
        }}
      >
        <div className="space-y-space-sm font-body text-body text-ink">
          <p>Esta ação não pode ser desfeita.</p>
          <p>
            <strong>Será apagado:</strong> seu nome, e-mail, telefone, documento, profissão, cartões
            salvos, senha, dispositivos de notificação e o link da sua agenda. Você sai do app e não
            consegue mais entrar com esta conta.
          </p>
          <p>
            <strong>Será mantido, sem identificar você:</strong> reservas, pagamentos, estornos,
            assinaturas, aceites de termos e registros de auditoria, porque a legislação fiscal e
            contábil exige guardá-los.
          </p>
        </div>

        <Checkbox
          label="Minha conta usa apenas o login com Google (não tenho senha)"
          checked={googleOnly}
          onChange={(event) => {
            setGoogleOnly(event.target.checked);
            setError(null);
          }}
        />
        {googleOnly ? (
          <Input
            label={`Digite ${CONFIRM_TEXT} para confirmar`}
            autoComplete="off"
            value={confirmText}
            onChange={(event) => {
              setConfirmText(event.target.value);
            }}
          />
        ) : (
          <PasswordInput
            label="Senha atual"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
            }}
          />
        )}

        {error ? <Alert tone="error">{error}</Alert> : null}
        {blockers && (blockers.bookings.length > 0 || blockers.subscriptions.length > 0) ? (
          <div className="space-y-space-xs">
            <p className="font-small text-small text-ink">
              Resolva estes compromissos antes de excluir a conta:
            </p>
            <ul
              aria-label="Compromissos em aberto"
              className="list-disc pl-space-lg font-small text-small text-ink"
            >
              {blockers.bookings.map((booking) => (
                <li key={`booking-${booking.code}`}>Reserva {booking.code}</li>
              ))}
              {blockers.subscriptions.map((subscription) => (
                <li key={`subscription-${subscription.id}`}>Assinatura {subscription.id}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="flex flex-wrap justify-end gap-space-sm">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={!ready} loading={remove.isPending}>
            Excluir minha conta
          </Button>
        </div>
      </form>
    </Modal>
  );
}
