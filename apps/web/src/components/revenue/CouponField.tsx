import { formatBRL, revenueQuoteSchema } from '@bravo/core';
import { useState } from 'react';
import type { CheckoutSlotProps } from '../../features/booking/checkout-options';
import { Button } from '../ui/Button';
import { Alert } from '../ui/Feedback';
import { Input } from '../ui/form';

export interface CouponFieldViewProps {
  /** Code currently applied (already upper-case), if any. */
  appliedCode: string | undefined;
  /** Discount the applied coupon gives, in cents. */
  discountCents: number;
  /** Why the typed coupon was refused (REC-117). */
  rejectionMessage?: string | undefined;
  /** Why the discount shown is the biggest one (REC-121). */
  note?: string | undefined;
  onApply: (code: string) => void;
  onRemove: () => void;
}

/** Coupon input, applied discount and rejection message; shared by the checkout slot and the subscription page. */
export function CouponFieldView({
  appliedCode,
  discountCents,
  rejectionMessage,
  note,
  onApply,
  onRemove,
}: CouponFieldViewProps) {
  const [draft, setDraft] = useState(appliedCode ?? '');

  const apply = () => {
    const code = draft.trim().toUpperCase();
    if (code !== '') onApply(code);
  };
  const remove = () => {
    setDraft('');
    onRemove();
  };

  return (
    <section aria-label="Cupom" className="space-y-space-sm">
      {appliedCode && !rejectionMessage ? (
        <div className="flex flex-wrap items-center justify-between gap-space-sm">
          <p className="font-small text-small text-ink">
            {`Cupom ${appliedCode} aplicado`}
            {discountCents > 0 ? `: − ${formatBRL(discountCents)}` : ''}
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
            error={rejectionMessage}
            autoComplete="off"
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
          {appliedCode ? (
            <Button variant="ghost" onClick={remove}>
              Remover
            </Button>
          ) : null}
        </div>
      )}
      {note ? <Alert>{note}</Alert> : null}
    </section>
  );
}

/** Slot `checkout.summary.discount`: reads the coupon state from `Quote.extensions` (REC-117, REC-121). */
export function CouponField({ quote, options, onOptionsChange }: CheckoutSlotProps) {
  const parsed = revenueQuoteSchema.safeParse(quote.extensions);
  if (!parsed.success) return null;

  const { discount } = parsed.data;
  return (
    <CouponFieldView
      appliedCode={options.couponCode}
      discountCents={discount.couponDiscountCents}
      rejectionMessage={discount.couponRejection?.message}
      note={discount.note}
      onApply={(code) => {
        onOptionsChange({ couponCode: code });
      }}
      onRemove={() => {
        onOptionsChange({ couponCode: undefined });
      }}
    />
  );
}
