import type { PaymentMode } from '@bravo/core';
import type { PaymentModeHandler, Registry } from './registry';

// Núcleo-only behavior (NUC-201): later features replace these ports in `extensions/index.ts`.

const modeHandler = (mode: PaymentMode): PaymentModeHandler => ({ mode });

/** A fresh registry with the núcleo defaults; each call returns independent arrays and objects. */
export function defaultRegistry(): Registry {
  return {
    checkoutSteps: [],
    paymentModeHandlers: [
      modeHandler('deposit_balance'),
      modeHandler('full_upfront'),
      modeHandler('manual'),
    ],
    // Until receita installs the live port nothing is spendable; grants are recorded in
    // `booking_events.data.creditGrant` by the calling service.
    credits: {
      mode: 'deferred',
      availableCents: () => Promise.resolve(0),
      grant: () => Promise.resolve({ creditLotId: null }),
    },
    closedDayCompensation: {
      preview: () =>
        Promise.resolve({ subscribers: 0, minutes: 0, creditCents: 0, fixedOccurrencesCancelled: 0 }),
      apply: () => Promise.resolve(),
    },
    availabilityDecorators: [],
    categoryHandlers: [],
    chargeHandlers: {},
    notifications: { notifyStaff: () => Promise.resolve() },
    roomMedia: { photoUrl: () => null },
  };
}
