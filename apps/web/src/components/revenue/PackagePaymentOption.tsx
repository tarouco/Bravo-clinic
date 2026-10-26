import { revenueQuoteSchema, type PackageOption } from '@bravo/core';
import { Link } from 'react-router-dom';
import type { CheckoutSlotProps } from '../../features/booking/checkout-options';
import { formatMinutes, formatWindow } from '../../features/purchases/format';
import { Button } from '../ui/Button';
import { Alert } from '../ui/Feedback';

const EXTRA_HOURS_PATH = '/app/compras/horas-extras';

/** Blocking reasons other than a short balance (REC-25, REC-31, REC-55). */
function reasonMessage(option: PackageOption): string | null {
  switch (option.reason) {
    case 'outside_period':
      return 'Esta data está fora do período do seu pacote e suas horas extras não cobrem esta reserva.';
    case 'block_category':
      return 'Reservas de turno não podem ser pagas com pacote de horas.';
    case 'suspended':
      return 'Sua assinatura está suspensa: regularize o pagamento para usar o pacote.';
    case 'insufficient':
    case undefined:
      return null;
  }
}

/**
 * Slot `checkout.summary.payWith`: "Pagar com meu pacote" with the debit preview, the calculation
 * disclosure and the insufficient-balance path (REC-24, REC-28).
 */
export function PackagePaymentOption({ quote, options, onOptionsChange }: CheckoutSlotProps) {
  const parsed = revenueQuoteSchema.safeParse(quote.extensions);
  if (!parsed.success || parsed.data.packageOption === null) return null;

  const option = parsed.data.packageOption;
  const usingPackage = options.payWith === 'package';
  const available = option.packageAvailableMinutes + option.extraAvailableMinutes;
  const blocked = reasonMessage(option);

  return (
    <fieldset className="space-y-space-sm">
      <legend className="mb-space-sm font-small text-small text-ink">Forma de pagamento</legend>

      <label className="flex items-start gap-space-sm font-small text-small text-ink">
        <input
          type="radio"
          name="pay-with"
          className="mt-0.5 h-5 w-5 shrink-0 accent-bronze"
          checked={usingPackage}
          disabled={!option.sufficient}
          onChange={() => {
            onOptionsChange({ payWith: 'package' });
          }}
        />
        <span>Pagar com meu pacote</span>
      </label>

      {option.sufficient ? (
        <>
          <p className="font-small text-small text-ink-muted">
            {`Esta reserva vai debitar ${formatMinutes(option.debitMinutes)} do seu pacote`}
          </p>
          <details className="font-small text-small text-ink-muted">
            <summary className="cursor-pointer text-bronze">Ver como calculamos</summary>
            <p className="mt-space-xs">{option.detailText}</p>
            <ul className="mt-space-xs space-y-space-xs">
              {option.breakdown.map((part) => (
                <li key={`${String(part.startMinute)}-${String(part.endMinute)}`}>
                  {`${formatWindow(part.startMinute, part.endMinute)} · ${formatMinutes(part.minutes)}`}
                </li>
              ))}
            </ul>
          </details>
          <label className="flex items-start gap-space-sm font-small text-small text-ink">
            <input
              type="radio"
              name="pay-with"
              className="mt-0.5 h-5 w-5 shrink-0 accent-bronze"
              checked={!usingPackage}
              onChange={() => {
                onOptionsChange({ payWith: 'money' });
              }}
            />
            <span>Pagar esta reserva</span>
          </label>
        </>
      ) : (
        <div className="space-y-space-sm">
          <Alert tone="error">
            {blocked ??
              `Saldo insuficiente: esta reserva debita ${formatMinutes(option.debitMinutes)} e você tem ${formatMinutes(available)}`}
          </Alert>
          <div className="flex flex-wrap items-center gap-space-sm">
            {option.reason === 'suspended' || option.reason === 'block_category' ? null : (
              <Button asChild variant="secondary" size="sm">
                <Link to={EXTRA_HOURS_PATH}>Comprar horas extras</Link>
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                onOptionsChange({ payWith: 'money' });
              }}
            >
              Pagar esta reserva
            </Button>
          </div>
        </div>
      )}
    </fieldset>
  );
}
