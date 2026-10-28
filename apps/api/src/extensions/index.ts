import {
  closedDayCompensationPort,
  liveCreditPort,
  packageModeHandler,
  slotDiscountDecorator,
  subscriptionModeHandler,
} from '../modules/revenue/ports';
import { extraHoursHandler } from '../modules/extra-hours/extra-hours.service';
import { extrasStep } from '../modules/extras/extras-step';
import { roomMediaPort } from '../modules/rooms/rooms-admin.service';
import { creditStep, discountStep, packageStep } from '../modules/revenue/steps';
import {
  fixedScheduleHandler,
  hourPackageHandler,
} from '../modules/subscriptions/category-handlers';
import {
  subscriptionInitialHandler,
  subscriptionRenewalHandler,
} from '../modules/subscriptions/charge-handlers';
import { defaultRegistry } from './defaults';
import { createRegistry, type Registry } from './registry';

/**
 * The one file later features edit to register their ports (AD-033): receita adds checkout steps,
 * payment-mode handlers, the live credit port, the closed-day compensation port, an availability
 * decorator, category handlers and charge handlers; gestao adds its notification and room-media ports.
 */
export function buildRegistry(): Registry {
  return createRegistry({
    // receita (AD-031)
    // receita discount (100), package (200), credit (400); gestao extras (300, R6)
    checkoutSteps: [discountStep, packageStep, extrasStep, creditStep],
    paymentModeHandlers: [
      ...defaultRegistry().paymentModeHandlers,
      packageModeHandler,
      subscriptionModeHandler,
    ],
    credits: liveCreditPort,
    closedDayCompensation: closedDayCompensationPort,
    availabilityDecorators: [slotDiscountDecorator],
    categoryHandlers: [hourPackageHandler, fixedScheduleHandler],
    chargeHandlers: {
      subscription_initial: subscriptionInitialHandler,
      subscription_renewal: subscriptionRenewalHandler,
      extra_hours: extraHoursHandler,
    },
    // gestao: public room photo URLs `/media/<key>-large.webp` (R13)
    roomMedia: roomMediaPort,
  });
}

export type { Registry } from './registry';
