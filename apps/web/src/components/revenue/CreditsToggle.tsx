import { formatBRL, revenueQuoteSchema } from '@bravo/core';
import type { CheckoutSlotProps } from '../../features/booking/checkout-options';
import { Checkbox } from '../ui/form';

/** Slot `checkout.summary.credits`: "Usar créditos (R$ X disponíveis)" and the applied amount (REC-107). */
export function CreditsToggle({ quote, options, onOptionsChange }: CheckoutSlotProps) {
  const parsed = revenueQuoteSchema.safeParse(quote.extensions);
  if (!parsed.success || parsed.data.credit.availableCents <= 0) return null;

  const { availableCents, appliedCents } = parsed.data.credit;
  const checked = options.useCredits ?? false;

  return (
    <section aria-label="Créditos" className="space-y-space-xs">
      <Checkbox
        label={`Usar créditos (${formatBRL(availableCents)} disponíveis)`}
        checked={checked}
        onChange={(event) => {
          onOptionsChange({ useCredits: event.target.checked });
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
