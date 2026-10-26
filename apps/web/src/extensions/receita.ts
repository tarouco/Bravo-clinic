import { CouponField } from '../components/revenue/CouponField';
import { CreditsToggle } from '../components/revenue/CreditsToggle';
import { PackagePaymentOption } from '../components/revenue/PackagePaymentOption';
import { PackageCategoryForms } from '../features/admin-categories/PackageCategoryForms';
import {
  SlotDiscountAction,
  SlotDiscountOverlay,
} from '../features/admin-reservas/SlotDiscountSlots';
import { AssinaturasTab } from '../features/admin-reservas/AssinaturasTab';
import { SellSubscriptionAction } from '../features/admin-reservas/SellSubscriptionDialog';
import { PackagesSection } from '../features/purchases/PackagesSection';
import { registerSlot, slotComponents, type SlotComponent, type SlotName } from './slots';

// receita fills núcleo's web slots (design.md "Required from nucleo" table A, AD-031). Each slot
// registration is idempotent so tests and hot reloads can call `registerRevenueSlots()` again.

const REGISTRATIONS: readonly (readonly [SlotName, SlotComponent])[] = [
  ['checkout.summary.discount', CouponField],
  ['checkout.summary.credits', CreditsToggle],
  ['checkout.summary.payWith', PackagePaymentOption],
  ['pricing.packages', PackagesSection],
  ['admin.categories.forms', PackageCategoryForms],
  ['admin.calendar.freeSlotActions', SlotDiscountAction],
  ['admin.calendar.overlays', SlotDiscountOverlay],
  ['admin.reservations.tabs', AssinaturasTab],
  ['admin.reservations.headerActions', SellSubscriptionAction],
];

export function registerRevenueSlots(): void {
  for (const [name, component] of REGISTRATIONS) {
    if (!slotComponents(name).includes(component)) registerSlot(name, component);
  }
}
