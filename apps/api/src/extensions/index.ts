import {
  closedDayCompensationPort,
  liveCreditPort,
  packageModeHandler,
  slotDiscountDecorator,
  subscriptionModeHandler,
} from '../modules/revenue/ports';
import { creditStep, discountStep, packageStep } from '../modules/revenue/steps';
import { defaultRegistry } from './defaults';
import { createRegistry, type Registry } from './registry';

/**
 * The one file later features edit to register their ports (AD-033): receita adds checkout steps,
 * payment-mode handlers, the live credit port, the closed-day compensation port, an availability
 * decorator and category handlers; gestao adds its notification and room-media ports.
 */
export function buildRegistry(): Registry {
  return createRegistry({
    // receita (AD-031)
    checkoutSteps: [discountStep, packageStep, creditStep],
    paymentModeHandlers: [
      ...defaultRegistry().paymentModeHandlers,
      packageModeHandler,
      subscriptionModeHandler,
    ],
    credits: liveCreditPort,
    closedDayCompensation: closedDayCompensationPort,
    availabilityDecorators: [slotDiscountDecorator],
  });
}

export type { Registry } from './registry';
