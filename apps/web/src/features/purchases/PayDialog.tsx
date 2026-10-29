import { formatBRL, type PayInput } from '@bravo/core';
import { useRef, useState } from 'react';
import { CreditsToggleView } from '../../components/revenue/CreditsToggle';
import { Button } from '../../components/ui/Button';
import { Alert, Spinner } from '../../components/ui/Feedback';
import { Modal } from '../../components/ui/Modal';
import { ApiError } from '../../lib/api';
import { newIdempotencyKey } from '../../lib/query-string';
import { PaymentMethodPanel, type PayChoice } from '../payments/PaymentMethodPanel';
import { useCredits, usePaySubscription, useSubscription } from './api';
import { periodText } from './subscribe-summary';

export interface PayDialogProps {
  subscriptionId: string;
  onClose: () => void;
}

/**
 * Pays an awaiting subscription or regularizes a suspended one (REC-144). The amount is the
 * period that is waiting for payment; credits can cover part or all of it.
 */
export function PayDialog({ subscriptionId, onClose }: PayDialogProps) {
  const [submitted, setSubmitted] = useState(false);
  const [creditsOn, setCreditsOn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const subscription = useSubscription(subscriptionId, { poll: submitted });
  const credits = useCredits();
  const pay = usePaySubscription(subscriptionId);
  // One Idempotency-Key per distinct attempt: retrying the same body replays the same key.
  const attempt = useRef<{ body: string; key: string } | null>(null);

  const data = subscription.data;
  const period =
    [data?.currentPeriod, data?.nextPeriod].find(
      (candidate) => candidate?.status === 'awaiting_payment',
    ) ?? null;
  const amountCents = period ? period.priceCents - period.discountCents : 0;
  const availableCredit = credits.data?.availableCents ?? 0;
  const appliedCredit = creditsOn ? Math.min(availableCredit, amountCents) : 0;
  const payNowCents = amountCents - appliedCredit;
  const payable = data?.status === 'awaiting_payment' || data?.status === 'suspended';

  const submit = async (choice: PayChoice) => {
    const body: PayInput = {
      paymentMethod: choice.method,
      ...(choice.savedCardId ? { savedCardId: choice.savedCardId } : {}),
      ...(creditsOn ? { useCredits: true } : {}),
    };
    const serialized = JSON.stringify(body);
    if (attempt.current?.body !== serialized) {
      attempt.current = { body: serialized, key: newIdempotencyKey() };
    }
    const result = await pay.mutateAsync({ body, idempotencyKey: attempt.current.key });
    setSubmitted(true);
    return result;
  };

  const onPay = async (choice: PayChoice) => {
    const result = await submit(choice);
    if (!result.charge) throw new Error('A cobrança não foi gerada.');
    return result.charge;
  };

  const confirmWithCredits = async () => {
    setError(null);
    try {
      await submit({ method: 'pix' });
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'Não foi possível concluir o pagamento.',
      );
    }
  };

  let body;
  if (subscription.isPending) {
    body = <Spinner label="Carregando a assinatura" />;
  } else if (subscription.isError || !data) {
    body = <Alert tone="error">Não foi possível carregar a assinatura agora.</Alert>;
  } else if (submitted && data.status === 'active') {
    body = (
      <div className="space-y-space-md">
        <Alert tone="success">
          <p className="font-medium">Pagamento confirmado</p>
          <p>{`Seu ${data.category.name} está ativo.`}</p>
        </Alert>
        <Button onClick={onClose}>Fechar</Button>
      </div>
    );
  } else if (!payable || !period) {
    body = (
      <div className="space-y-space-md">
        <Alert>Esta assinatura não tem pagamento pendente.</Alert>
        <Button variant="secondary" onClick={onClose}>
          Fechar
        </Button>
      </div>
    );
  } else {
    body = (
      <div className="space-y-space-md">
        <dl className="space-y-space-xs rounded-md bg-surface-deboss p-space-md font-small text-small shadow-deboss">
          <div className="flex justify-between gap-space-md">
            <dt className="text-ink-muted">{data.category.name}</dt>
            <dd className="text-ink">{periodText(period)}</dd>
          </div>
          <div className="flex justify-between gap-space-md">
            <dt className="text-ink-muted">Valor do período</dt>
            <dd className="text-ink">{formatBRL(amountCents)}</dd>
          </div>
          {appliedCredit > 0 ? (
            <div className="flex justify-between gap-space-md">
              <dt className="text-ink-muted">Créditos</dt>
              <dd className="text-ink">{`− ${formatBRL(appliedCredit)}`}</dd>
            </div>
          ) : null}
          <div className="flex justify-between gap-space-md font-medium">
            <dt className="text-ink">Pagar agora</dt>
            <dd className="text-ink">{formatBRL(payNowCents)}</dd>
          </div>
        </dl>
        {!submitted ? (
          <CreditsToggleView
            availableCents={availableCredit}
            appliedCents={appliedCredit}
            checked={creditsOn}
            onChange={setCreditsOn}
          />
        ) : null}
        {error ? <Alert tone="error">{error}</Alert> : null}
        {payNowCents > 0 ? (
          <PaymentMethodPanel amountCents={payNowCents} onPay={onPay} />
        ) : (
          <Button loading={pay.isPending} onClick={() => void confirmWithCredits()}>
            Pagar com créditos
          </Button>
        )}
        {submitted ? (
          <p role="status" className="font-small text-small text-ink-muted">
            Aguardando a confirmação do pagamento…
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <Modal open onClose={onClose} title="Pagar assinatura">
      {body}
    </Modal>
  );
}
