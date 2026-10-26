import { CouponField } from '../components/revenue/CouponField';
import { CreditsToggle } from '../components/revenue/CreditsToggle';
import { registerSlot, slotComponents, type SlotComponent, type SlotName } from './slots';

// receita fills núcleo's web slots (design.md "Required from nucleo" table A, AD-031). Each slot
// registration is idempotent so tests and hot reloads can call `registerRevenueSlots()` again.

const REGISTRATIONS: readonly (readonly [SlotName, SlotComponent])[] = [
  ['checkout.summary.discount', CouponField],
  ['checkout.summary.credits', CreditsToggle],
];

export function registerRevenueSlots(): void {
  for (const [name, component] of REGISTRATIONS) {
    if (!slotComponents(name).includes(component)) registerSlot(name, component);
  }
}
