import { formatBRL, revenueQuoteSchema } from '@bravo/core';
import { useState } from 'react';
import type { CheckoutSlotProps } from '../../features/booking/checkout-options';
import { Button } from '../ui/Button';
import { Alert } from '../ui/Feedback';
import { Input } from '../ui/form';

/** Slot `checkout.summary.discount`: coupon input, applied discount, rejection and the note (REC-117, REC-121). */
export function CouponField({ quote, options, onOptionsChange }: CheckoutSlotProps) {
  const parsed = revenueQuoteSchema.safeParse(quote.extensions);
  const [draft, setDraft] = useState(options.couponCode ?? '');
  if (!parsed.success) return null;

  const { discount } = parsed.data;
  const applied = options.couponCode;
  const rejection = discount.couponRejection;

  const apply = () => {
    const code = draft.trim().toUpperCase();
    if (code !== '') onOptionsChange({ couponCode: code });
  };
  const remove = () => {
    setDraft('');
    onOptionsChange({ couponCode: undefined });
  };

  return (
    <section aria-label="Cupom" className="space-y-space-sm">
      {applied && !rejection ? (
        <div className="flex flex-wrap items-center justify-between gap-space-sm">
          <p className="font-small text-small text-ink">
            {`Cupom ${applied} aplicado`}
            {discount.couponDiscountCents > 0
              ? `: − ${formatBRL(discount.couponDiscountCents)}`
              : ''}
          </p>
          <Button variant="ghost" size="sm" onClick={remove}>
            Remover
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-space-sm">
          <Input
            label="Cupom de desconto"
            value={draft}
            error={rejection?.message}
            autoComplete="off"
            className="uppercase"
            onChange={(event) => {
              setDraft(event.target.value.toUpperCase());
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                apply();
              }
            }}
          />
          <Button variant="secondary" disabled={draft.trim() === ''} onClick={apply}>
            Aplicar
          </Button>
          {applied ? (
            <Button variant="ghost" onClick={remove}>
              Remover
            </Button>
          ) : null}
        </div>
      )}
      {discount.note ? <Alert>{discount.note}</Alert> : null}
    </section>
  );
}
