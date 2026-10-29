import { deleteWithJustificationSchema } from '@bravo/core';
import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Alert } from '../../components/ui/Feedback';
import { Textarea } from '../../components/ui/form';
import { Modal } from '../../components/ui/Modal';
import { messageOf } from '../../lib/api-errors';
import { commitmentsOf, type Commitments } from '../../lib/commitments';
import { useAnonymizeCustomer } from './api';

export interface AnonymizeModalProps {
  customerId: string;
  customerName: string;
  onClose: () => void;
  /** Called after the API anonymized the account. */
  onDone: () => void;
}

/**
 * LGPD erasure on the customer's request (GES-127): needs a justification of 5..500 characters;
 * open bookings and subscriptions block it (409) and are listed for the admin to resolve first.
 */
export function AnonymizeModal({ customerId, customerName, onClose, onDone }: AnonymizeModalProps) {
  const anonymize = useAnonymizeCustomer(customerId);
  const [justification, setJustification] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<Commitments | null>(null);
  const check = deleteWithJustificationSchema.safeParse({ justification });

  return (
    <Modal open onClose={onClose} title="Excluir dados do cliente">
      <form
        className="space-y-space-md"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!check.success) return;
          setError(null);
          setBlockers(null);
          anonymize.mutate(check.data.justification, {
            onSuccess: onDone,
            onError: (failure) => {
              const commitments = commitmentsOf(failure);
              if (commitments) setBlockers(commitments);
              setError(messageOf(failure, 'Não foi possível excluir os dados do cliente.'));
            },
          });
        }}
      >
        <p className="font-body text-body text-ink">
          Os dados pessoais de {customerName} serão apagados e a conta deixa de existir. Reservas,
          cobranças e a auditoria continuam registradas, sem identificar a pessoa, como exige a
          legislação fiscal. Esta ação não pode ser desfeita.
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
        {blockers && (blockers.bookings.length > 0 || blockers.subscriptions.length > 0) ? (
          <div className="space-y-space-xs">
            <p className="font-small text-small text-ink">
              Resolva estes compromissos antes de excluir os dados:
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
          <Button
            className="text-danger"
            variant="secondary"
            type="submit"
            disabled={!check.success}
            loading={anonymize.isPending}
          >
            Excluir dados
          </Button>
        </div>
      </form>
    </Modal>
  );
}
