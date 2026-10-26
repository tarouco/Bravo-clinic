import { formatBRL, type ChargeIntent, type PayRequest } from '@bravo/core';
import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { CopyField } from '../../components/ui/CopyField';
import { cx } from '../../components/ui/cx';
import { Alert } from '../../components/ui/Feedback';
import { ApiError } from '../../lib/api';
import { redirectTo } from '../../lib/redirect';
import { useCards } from './api';

export type PayChoice = Pick<PayRequest, 'method' | 'savedCardId'>;

export interface PaymentMethodPanelProps {
  /** Amount charged now, in cents (shown on the pay button). */
  amountCents: number;
  /** Creates the charge for the chosen method and returns its intent. */
  onPay: (choice: PayChoice) => Promise<ChargeIntent>;
  /** A charge that already exists (a reschedule difference): shown without asking for a method. */
  intent?: ChargeIntent | null | undefined;
  /** Id of a charge the gateway rejected: shows the message and lets the user try another method. */
  rejectedChargeId?: string | null | undefined;
  /** Blocks paying (for example while a required acceptance is pending). */
  disabled?: boolean;
  /** Called with every error `onPay` throws, after the panel shows it. */
  onError?: (error: unknown) => void;
  className?: string;
}

const optionClasses = (checked: boolean) =>
  cx(
    'flex cursor-pointer items-center gap-space-sm rounded-card border p-space-md font-small text-small transition-colors focus-within:ring-2 focus-within:ring-bronze',
    checked
      ? 'border-bronze bg-champagne-soft text-on-champagne'
      : 'border-hairline bg-surface-raised text-ink hover:border-bronze',
  );

const brandName = (brand: string): string => brand.charAt(0).toUpperCase() + brand.slice(1);

function IntentView({
  intent,
  onChooseAnother,
}: {
  intent: ChargeIntent;
  onChooseAnother: () => void;
}) {
  if (intent.method === 'pix') {
    return (
      <div className="space-y-space-md">
        <p className="font-small text-small text-ink">
          Pague {formatBRL(intent.amountCents)} com Pix. O pagamento é confirmado em instantes.
        </p>
        {intent.pixQrCodeBase64 ? (
          <img
            alt="QR Code do Pix"
            src={`data:image/png;base64,${intent.pixQrCodeBase64}`}
            className="mx-auto h-48 w-48 rounded-card border border-hairline bg-white p-space-xs"
          />
        ) : null}
        {intent.pixCopyPaste ? (
          <CopyField
            label="Pix copia e cola"
            value={intent.pixCopyPaste}
            buttonLabel="Copiar código Pix"
          />
        ) : null}
        <p role="status" className="font-small text-small text-ink-muted">
          Aguardando o pagamento…
        </p>
        {intent.checkoutUrl ? (
          // The provider's hosted Pix page (the sandbox approves or rejects the charge there).
          <Button asChild variant="secondary" size="sm">
            <a href={intent.checkoutUrl}>Abrir página de pagamento</a>
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" onClick={onChooseAnother}>
          Usar outro método
        </Button>
      </div>
    );
  }
  if (intent.status === 'approved') {
    return (
      <p role="status" className="font-small text-small text-ink">
        Pagamento aprovado. Confirmando sua reserva…
      </p>
    );
  }
  return (
    <div className="space-y-space-md">
      <p role="status" className="font-small text-small text-ink">
        {intent.checkoutUrl ? 'Abrindo a página segura de pagamento…' : 'Processando o pagamento…'}
      </p>
      {intent.checkoutUrl ? (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            redirectTo(intent.checkoutUrl ?? '');
          }}
        >
          Abrir página de pagamento
        </Button>
      ) : null}
      <Button variant="ghost" size="sm" onClick={onChooseAnother}>
        Usar outro método
      </Button>
    </div>
  );
}

/**
 * Method choice (Pix, card, saved card) and the resulting charge: Pix QR code with copy and paste,
 * card redirect to the provider page, saved-card processing. Used by the checkout, the balance
 * payment and the reschedule difference (NUC-103, NUC-118).
 */
export function PaymentMethodPanel({
  amountCents,
  onPay,
  intent: initialIntent,
  rejectedChargeId = null,
  disabled = false,
  onError,
  className,
}: PaymentMethodPanelProps) {
  const cards = useCards();
  const [choice, setChoice] = useState<string>('pix');
  const [intent, setIntent] = useState<ChargeIntent | null>(initialIntent ?? null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setIntent(initialIntent ?? null);
  }, [initialIntent]);

  useEffect(() => {
    if (rejectedChargeId) setIntent(null);
  }, [rejectedChargeId]);

  const pay = async () => {
    const savedCardId = choice.startsWith('saved:') ? choice.slice('saved:'.length) : undefined;
    const payChoice: PayChoice = savedCardId
      ? { method: 'saved_card', savedCardId }
      : { method: choice === 'card' ? 'card' : 'pix' };
    setPending(true);
    setError(null);
    try {
      const created = await onPay(payChoice);
      setIntent(created);
      if (created.method === 'card' && created.checkoutUrl) redirectTo(created.checkoutUrl);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Não foi possível iniciar o pagamento. Tente novamente.',
      );
      onError?.(caught);
    } finally {
      setPending(false);
    }
  };

  if (intent) {
    return (
      <div className={className}>
        <IntentView
          intent={intent}
          onChooseAnother={() => {
            setIntent(null);
          }}
        />
      </div>
    );
  }

  return (
    <div className={cx('space-y-space-md', className)}>
      {rejectedChargeId ? (
        <Alert tone="error">Pagamento recusado. Tente outro método.</Alert>
      ) : null}
      {error ? <Alert tone="error">{error}</Alert> : null}
      <fieldset className="space-y-space-sm">
        <legend className="font-heading-mobile text-body text-ink">Forma de pagamento</legend>
        <label className={optionClasses(choice === 'pix')}>
          <input
            type="radio"
            name="payment-method"
            value="pix"
            checked={choice === 'pix'}
            onChange={() => {
              setChoice('pix');
            }}
            className="h-4 w-4 accent-bronze"
          />
          Pix
        </label>
        <label className={optionClasses(choice === 'card')}>
          <input
            type="radio"
            name="payment-method"
            value="card"
            checked={choice === 'card'}
            onChange={() => {
              setChoice('card');
            }}
            className="h-4 w-4 accent-bronze"
          />
          Cartão de crédito ou débito
        </label>
        {(cards.data?.items ?? []).map((card) => {
          const value = `saved:${card.id}`;
          return (
            <label key={card.id} className={optionClasses(choice === value)}>
              <input
                type="radio"
                name="payment-method"
                value={value}
                checked={choice === value}
                onChange={() => {
                  setChoice(value);
                }}
                className="h-4 w-4 accent-bronze"
              />
              {brandName(card.brand)} final {card.last4}
            </label>
          );
        })}
      </fieldset>
      <Button disabled={disabled} loading={pending} onClick={() => void pay()}>
        Pagar {formatBRL(amountCents)}
      </Button>
    </div>
  );
}
