import type { Quote, QuoteRequest } from '@bravo/core';

/**
 * Optional checkout choices that extension slots (receita) put on the quote and booking requests:
 * coupon code, credits and how to pay (`QuoteRequest`).
 */
export interface CheckoutOptions {
  couponCode?: string | undefined;
  useCredits?: boolean | undefined;
  payWith?: 'money' | 'package' | undefined;
}

/** Props of the `checkout.summary.discount`, `.credits` and `.payWith` slots. */
export interface CheckoutSlotProps {
  quote: Quote;
  options: CheckoutOptions;
  /** Merges `patch` into the options; an `undefined` value clears that option. */
  onOptionsChange: (patch: CheckoutOptions) => void;
}

/** The defined options as `QuoteRequest` fields (undefined values are left out). */
export function optionsToRequest(
  options: CheckoutOptions,
): Pick<QuoteRequest, 'couponCode' | 'useCredits' | 'payWith'> {
  return {
    ...(options.couponCode ? { couponCode: options.couponCode } : {}),
    ...(options.useCredits ? { useCredits: true } : {}),
    ...(options.payWith ? { payWith: options.payWith } : {}),
  };
}
