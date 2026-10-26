import { formatBRL, revenueQuoteSchema } from '@bravo/core';
import type { CheckoutSlotProps } from '../../features/booking/checkout-options';
import { Checkbox } from '../ui/form';

export interface CreditsToggleViewProps {
  availableCents: number;
  appliedCents: number;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

/** "Usar créditos (R$ X disponíveis)" and the applied amount; nothing without credits (REC-107). */
export function CreditsToggleView({
  availableCents,
  appliedCents,
  checked,
  onChange,
}: CreditsToggleViewProps) {
  if (availableCents <= 0) return null;
  return (
    <section aria-label="Créditos" className="space-y-space-xs">
      <Checkbox
        label={`Usar créditos (${formatBRL(availableCents)} disponíveis)`}
        checked={checked}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
      />
      {checked && appliedCents > 0 ? (
        <p className="font-small text-small text-ink-muted">
          {`Créditos aplicados: − ${formatBRL(appliedCents)}`}
        </p>
      ) : null}
    </section>
  );
}

/** Slot `checkout.summary.credits`: reads the credit state from `Quote.extensions`. */
export function CreditsToggle({ quote, options, onOptionsChange }: CheckoutSlotProps) {
  const parsed = revenueQuoteSchema.safeParse(quote.extensions);
  if (!parsed.success) return null;

  return (
    <CreditsToggleView
      availableCents={parsed.data.credit.availableCents}
      appliedCents={parsed.data.credit.appliedCents}
      checked={options.useCredits ?? false}
      onChange={(useCredits) => {
        onOptionsChange({ useCredits });
      }}
    />
  );
}
