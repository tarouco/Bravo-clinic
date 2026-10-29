import { formatBRL, type LocalDate, type SwitchInput, type SwitchQuoteInput } from '@bravo/core';
import { useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Alert, Spinner } from '../../components/ui/Feedback';
import { Select } from '../../components/ui/form';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/Toast';
import { messageOf } from '../../lib/api-errors';
import { formatLocalDateBR } from '../../lib/format';
import { newIdempotencyKey } from '../../lib/query-string';
import { PaymentMethodPanel, type PayChoice } from '../payments/PaymentMethodPanel';
import {
  useCancelPreview,
  useCancelSubscription,
  useExtraHours,
  usePackages,
  useSubscription,
  useSwitchQuote,
  useSwitchSubscription,
} from './api';
import { FixedSchedulePicker, PICKER_PARAMS } from './FixedSchedulePicker';
import { formatBalance } from './format';
import { periodText } from './subscribe-summary';
import type { Subscription } from './types';

export interface SubscriptionDialogProps {
  subscription: Subscription;
  onClose: () => void;
}

// ---- Cancel (REC-79) ----

/** "Suas horas extras continuam válidas até 08/02/2027": the soonest expiry among lots with minutes left. */
function useExtraKeptText(extraMinutesKept: number): { until: string | null } {
  const extra = useExtraHours();
  const expiries = (extra.data?.lots ?? [])
    .filter((lot) => lot.minutesRemaining > 0)
    .map((lot) => lot.expiresAt)
    .sort();
  const first = expiries[0];
  if (extraMinutesKept <= 0 || first === undefined) return { until: null };
  const local = new Date(first).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  return { until: formatLocalDateBR(local) };
}

/** Preview of what cancelling loses and keeps, then the explicit confirmation (REC-79). */
export function CancelSubscriptionDialog({ subscription, onClose }: SubscriptionDialogProps) {
  const { toast } = useToast();
  const preview = useCancelPreview(subscription.id);
  const cancel = useCancelSubscription(subscription.id);
  const kept = useExtraKeptText(preview.data?.extraMinutesKept ?? 0);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setError(null);
    try {
      await cancel.mutateAsync();
      toast({ message: 'Assinatura cancelada.' });
      onClose();
    } catch (caught) {
      setError(messageOf(caught, 'Não foi possível cancelar agora. Tente novamente.'));
    }
  };

  const data = preview.data;
  return (
    <Modal open onClose={onClose} title="Cancelar assinatura">
      <div className="space-y-space-md">
        <p className="font-small text-small text-ink-muted">{subscription.category.name}</p>
        {preview.isPending ? (
          <Spinner label="Calculando o que muda" />
        ) : preview.isError || !data ? (
          <Alert tone="error">
            {messageOf(preview.error, 'Não foi possível carregar o resumo do cancelamento.')}
          </Alert>
        ) : (
          <ul className="list-disc space-y-space-xs pl-space-md font-small text-small text-ink">
            {data.minutesLost !== undefined && data.minutesLost > 0 ? (
              <li>{`Você perde ${formatBalance(data.minutesLost)} de saldo deste período, sem reembolso`}</li>
            ) : null}
            {data.paidUpcomingPeriodLostCents !== undefined &&
            data.paidUpcomingPeriodLostCents > 0 ? (
              <li>
                {`Você perde também o próximo período já pago (${formatBRL(data.paidUpcomingPeriodLostCents)}), sem reembolso`}
              </li>
            ) : null}
            {data.occurrencesReleased !== undefined && data.occurrencesReleased > 0 ? (
              <li>
                {`${String(data.occurrencesReleased)} ${data.occurrencesReleased === 1 ? 'ocorrência futura será liberada' : 'ocorrências futuras serão liberadas'}`}
              </li>
            ) : null}
            <li>A assinatura não renova mais depois de cancelada.</li>
            {data.extraMinutesKept > 0 ? (
              <li>
                {kept.until
                  ? `Suas horas extras continuam válidas até ${kept.until}`
                  : 'Suas horas extras continuam válidas até o vencimento'}
                {` (${formatBalance(data.extraMinutesKept)})`}
              </li>
            ) : null}
          </ul>
        )}
        {error ? <Alert tone="error">{error}</Alert> : null}
        <div className="bv-modal-actions flex-wrap">
          <Button variant="secondary" onClick={onClose}>
            Manter assinatura
          </Button>
          <Button loading={cancel.isPending} disabled={!data} onClick={() => void confirm()}>
            Confirmar cancelamento
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ---- Switch (REC-72) ----

type SwitchStage = 'pick' | 'quote';

/** Target category, preview of the conversion and payment of the new period (REC-72, REC-76, REC-77). */
export function SwitchPackageDialog({ subscription, onClose }: SubscriptionDialogProps) {
  const packages = usePackages();
  const [params] = useSearchParams();
  const [targetId, setTargetId] = useState('');
  const [stage, setStage] = useState<SwitchStage>('pick');
  const [newId, setNewId] = useState<string | undefined>(undefined);
  const [payError, setPayError] = useState<string | null>(null);
  const swap = useSwitchSubscription(subscription.id);
  const attempt = useRef<{ body: string; key: string } | null>(null);

  const fixed = subscription.type === 'fixed_schedule';
  const targets = (packages.data?.items ?? []).filter(
    (offer) => offer.type === subscription.type && offer.id !== subscription.category.id,
  );
  const roomId = params.get(PICKER_PARAMS.room);
  const baseOn = params.get(PICKER_PARAMS.baseOn);

  // A fixed schedule is picked (room and start date) before it is quoted; an hour package is not.
  const picking = fixed && targetId !== '' && stage === 'pick';
  const request: SwitchQuoteInput | null =
    targetId === '' || picking
      ? null
      : fixed
        ? {
            categoryId: targetId,
            ...(roomId ? { roomId } : {}),
            ...(baseOn ? { baseOn: baseOn as LocalDate } : {}),
          }
        : { categoryId: targetId };
  const quote = useSwitchQuote(subscription.id, request);
  const watched = useSubscription(newId, { poll: newId !== undefined });

  const submit = async (choice: PayChoice) => {
    if (!request) throw new Error('Quote missing');
    const body: SwitchInput = {
      ...request,
      paymentMethod: choice.method,
      ...(choice.savedCardId ? { savedCardId: choice.savedCardId } : {}),
    };
    const serialized = JSON.stringify(body);
    if (attempt.current?.body !== serialized) {
      attempt.current = { body: serialized, key: newIdempotencyKey() };
    }
    const result = await swap.mutateAsync({ body, idempotencyKey: attempt.current.key });
    setNewId(result.subscription.id);
    return result;
  };

  const onPay = async (choice: PayChoice) => {
    const result = await submit(choice);
    if (!result.charge) throw new Error('A troca não gerou cobrança.');
    return result.charge;
  };

  const confirmWithoutPayment = async () => {
    setPayError(null);
    try {
      await submit({ method: 'pix' });
    } catch (caught) {
      setPayError(messageOf(caught, 'Não foi possível concluir a troca.'));
    }
  };

  const data = quote.data;
  const conflicts = data?.conflicts ?? [];
  const hasQuote = Boolean(data) && conflicts.length === 0;

  let body;
  if (watched.data?.status === 'active') {
    body = (
      <div className="space-y-space-md">
        <Alert tone="success">
          <p className="font-medium">Troca concluída</p>
          <p>{`Seu novo pacote ${watched.data.category.name} já está ativo.`}</p>
        </Alert>
        <Button onClick={onClose}>Fechar</Button>
      </div>
    );
  } else if (packages.isPending) {
    body = <Spinner label="Carregando os pacotes" />;
  } else if (targets.length === 0) {
    body = (
      <div className="space-y-space-md">
        <Alert>Não há outro pacote do mesmo tipo disponível para troca agora.</Alert>
        <Button variant="secondary" onClick={onClose}>
          Fechar
        </Button>
      </div>
    );
  } else {
    body = (
      <div className="space-y-space-md">
        <Select
          label="Novo pacote"
          value={targetId}
          disabled={newId !== undefined}
          onChange={(event) => {
            setTargetId(event.target.value);
            setStage('pick');
          }}
        >
          <option value="">Escolha o novo pacote</option>
          {targets.map((offer) => (
            <option key={offer.id} value={offer.id}>
              {offer.name}
            </option>
          ))}
        </Select>

        {picking ? (
          <FixedSchedulePicker
            categoryId={targetId}
            onContinue={() => {
              setStage('quote');
            }}
          />
        ) : null}

        {request ? (
          quote.isPending ? (
            <Spinner label="Calculando a troca" />
          ) : quote.isError ? (
            <Alert tone="error">
              {messageOf(quote.error, 'Não foi possível calcular a troca agora.')}
            </Alert>
          ) : data ? (
            <section aria-label="Resumo da troca" className="space-y-space-sm">
              {data.convertedMinutes !== undefined && data.remainingMinutes !== undefined ? (
                <p className="font-small text-small text-ink">
                  {`Seu saldo de ${formatBalance(data.remainingMinutes)} vira ${formatBalance(data.convertedMinutes)} no novo pacote`}
                </p>
              ) : null}
              {data.newPeriodTotalMinutes !== undefined ? (
                <p className="font-small text-small text-ink">
                  {`Total no novo período: ${formatBalance(data.newPeriodTotalMinutes)}`}
                </p>
              ) : null}
              {data.releasedOccurrences !== undefined && data.releasedOccurrences > 0 ? (
                <p className="font-small text-small text-ink">
                  {`${String(data.releasedOccurrences)} ocorrências futuras do horário atual serão liberadas`}
                </p>
              ) : null}
              <p className="font-small text-small text-ink-muted">
                {`Novo período: ${periodText(data)}`}
              </p>
              <dl className="space-y-space-xs rounded-md bg-surface-deboss p-space-md font-small text-small shadow-deboss">
                <div className="flex justify-between gap-space-md">
                  <dt className="text-ink-muted">Valor do novo período</dt>
                  <dd className="text-ink">{formatBRL(data.priceCents)}</dd>
                </div>
                {data.creditAppliedCents > 0 ? (
                  <div className="flex justify-between gap-space-md">
                    <dt className="text-ink-muted">Créditos</dt>
                    <dd className="text-ink">{`− ${formatBRL(data.creditAppliedCents)}`}</dd>
                  </div>
                ) : null}
                <div className="flex justify-between gap-space-md font-medium">
                  <dt className="text-ink">Pagar agora</dt>
                  <dd className="text-ink">{formatBRL(data.payNowCents)}</dd>
                </div>
              </dl>
              {conflicts.length > 0 ? (
                <Alert tone="error">
                  <p className="font-medium">Alguns horários não estão disponíveis:</p>
                  <ul className="mt-space-xs list-disc pl-space-md">
                    {conflicts.map((conflict) => (
                      <li
                        key={conflict.date}
                      >{`${formatLocalDateBR(conflict.date)}: ${conflict.label}`}</li>
                    ))}
                  </ul>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="mt-space-sm"
                    onClick={() => {
                      setStage('pick');
                    }}
                  >
                    Escolher outra sala ou data
                  </Button>
                </Alert>
              ) : null}
            </section>
          ) : null
        ) : null}

        {request && hasQuote && data ? (
          <div className="space-y-space-md">
            {payError ? <Alert tone="error">{payError}</Alert> : null}
            {data.payNowCents > 0 ? (
              <PaymentMethodPanel amountCents={data.payNowCents} onPay={onPay} />
            ) : (
              <Button loading={swap.isPending} onClick={() => void confirmWithoutPayment()}>
                Confirmar troca
              </Button>
            )}
            {newId ? (
              <p role="status" className="font-small text-small text-ink-muted">
                Aguardando a confirmação do pagamento…
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <Modal open onClose={onClose} title="Trocar pacote">
      {body}
    </Modal>
  );
}
