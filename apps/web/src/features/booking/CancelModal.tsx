import { formatBRL, type BookingDetail } from '@bravo/core';
import { useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Alert, Spinner } from '../../components/ui/Feedback';
import { Textarea } from '../../components/ui/form';
import { Modal } from '../../components/ui/Modal';
import { ApiError } from '../../lib/api';
import { newIdempotencyKey } from '../../lib/query-string';
import { formatDuration } from '../../lib/format';
import { useCancel, useCancellationPreview } from './api';

export interface CancelModalProps {
  booking: BookingDetail;
  open: boolean;
  onClose: () => void;
  onCancelled: () => void;
}

/** Cancellation dialog (NUC-156): what is retained and what comes back, before confirming. */
export function CancelModal({ booking, open, onClose, onCancelled }: CancelModalProps) {
  const hasPayment = booking.paidCents > 0;
  const preview = useCancellationPreview(booking.id, open && hasPayment);
  const cancel = useCancel(booking.id);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  // A retry of the same request (after a network error) replays its key; a new reason gets a new one.
  const attempt = useRef<{ body: string; key: string } | null>(null);

  const data = preview.data;
  const ready = !hasPayment || data !== undefined;

  const confirm = async () => {
    setError(null);
    const body = reason.trim() === '' ? {} : { reason: reason.trim() };
    const serialized = JSON.stringify(body);
    if (attempt.current?.body !== serialized) {
      attempt.current = { body: serialized, key: newIdempotencyKey() };
    }
    try {
      await cancel.mutateAsync({ body, idempotencyKey: attempt.current.key });
      onCancelled();
      onClose();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'Não foi possível cancelar. Tente novamente.',
      );
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Cancelar reserva">
      <div className="space-y-space-lg">
        <p className="font-small text-small text-ink-muted">
          {booking.roomName} · {booking.code}
        </p>

        {!hasPayment ? (
          <p className="font-small text-small text-ink">
            Nenhum pagamento foi feito ainda, então não há valor a devolver.
          </p>
        ) : preview.isPending ? (
          <Spinner label="Calculando o reembolso" />
        ) : preview.isError || !data ? (
          <Alert tone="error">
            {preview.error instanceof ApiError
              ? preview.error.message
              : 'Não foi possível calcular o reembolso agora.'}
          </Alert>
        ) : (
          <section aria-label="Resultado do cancelamento" className="space-y-space-xs">
            <p className="font-small text-small text-ink">
              Fica retido: {formatBRL(data.retainedCents)}
              {data.retainedCents === booking.depositCents ? ' (sinal)' : ''}
            </p>
            <p className="font-small text-small text-ink">
              Será devolvido: {formatBRL(data.refundCents)}
            </p>
            {data.minutesReturned > 0 ? (
              <p className="font-small text-small text-ink">
                Horas devolvidas ao seu pacote: {formatDuration(data.minutesReturned)}
              </p>
            ) : null}
            {data.creditCents > 0 ? (
              <p className="font-small text-small text-ink">
                Crédito gerado: {formatBRL(data.creditCents)}
              </p>
            ) : null}
          </section>
        )}

        <Textarea
          label="Motivo (opcional)"
          rows={3}
          maxLength={500}
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
          }}
        />

        {error ? <Alert tone="error">{error}</Alert> : null}

        <div className="flex flex-wrap justify-end gap-space-sm">
          <Button variant="secondary" onClick={onClose}>
            Manter reserva
          </Button>
          <Button disabled={!ready} loading={cancel.isPending} onClick={() => void confirm()}>
            Confirmar cancelamento
          </Button>
        </div>
      </div>
    </Modal>
  );
}
